#!/usr/bin/env bun
/**
 * duet-send: send a message to your Claude Duet coordinator (macOS / Linux / Windows)
 *
 *   bun run duet "message"
 *   echo "message" | bun run duet
 *   bun run duet --tag "[Discord bot]" "message"
 *   bun run duet --to work "message"   # send to the route "work" in the routes table
 *   bun run duet --dry-run "message"   # print the target and body, send nothing
 *   bun /path/to/send.ts --hook         # Claude Code Stop hook: reads the hook JSON on stdin
 *
 * The destination comes from a routes table (JSON mapping route names to session ids) kept
 * as the name of a Google Drive file shared by link, named by DUET_ROUTES_FILE_ID (see
 * routes.ts). If it cannot be read, DUET_SESSION_ID (the id itself) is used instead when set.
 * Without DUET_ROUTES_FILE_ID, DUET_SESSION_ID is used. With --to, only the routes table is
 * used: a route that can't be read or found is an error, never DUET_SESSION_ID.
 *
 * If sending fails and DUET_DISCORD_WEBHOOK is set, a short alert is posted there.
 */
import { FILE_ID_PATTERN, ID_PATTERN, RoutesError, driveTitleRoutesSource, loadRoutes, resolveRoute } from "./routes";

const MAX_LEN = 8000;
const DEFAULT_TAG = "[Claude Code]";
const HOOK_TAG = "[Claude Code: Stop]";
// A hook run gives up after this long, so it never hangs around.
const HOOK_TIMEOUT_MS = 60_000;

// In --hook mode every exit is 0, so a problem here never interrupts Claude Code.
// Errors still go to stderr (and to Discord when sending fails).
let hookMode = false;
function exit(code: number): never {
  process.exit(hookMode ? 0 : code);
}

function fail(msg: string, code = 1): never {
  console.error(`duet: ${msg}`);
  exit(code);
}

// Child processes, so the hook watchdog can stop them.
const children = new Set<{ kill(): void }>();

// ---------- arguments ----------
function parseArgs(argv: string[]) {
  let tag: string | null = null;
  let to: string | undefined;
  let dryRun = false;
  let verbose = false;
  let hook = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") {
      tag = argv[++i] ?? fail("--tag needs a value");
    } else if (a === "--to") {
      to = (argv[++i] ?? fail("--to needs a route name")).trim();
      if (!to) fail("--to needs a route name");
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--verbose") {
      verbose = true;
    } else if (a === "--hook") {
      hook = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        'usage: bun run duet [--to <route>] [--tag "[name]"] [--dry-run] [--verbose] "message"   (or pipe the message on stdin)\n' +
          "       bun /path/to/send.ts --hook [--to <route>] [--tag \"[name]\"]   (Claude Code Stop hook; reads the hook JSON on stdin)\n" +
          "  --to <route>   send to this route of the routes table instead of its default route",
      );
      process.exit(0);
    } else if (a === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    } else {
      rest.push(a);
    }
  }
  return { tag, to, dryRun, verbose, hook, text: rest.join(" ") };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return (await new Response(Bun.stdin.stream()).text()).trim();
}

// ---------- where the session id lives ----------
function parseId(raw: string, where: string): string {
  const id = raw.replace(/^\uFEFF/, "").trim();
  if (!ID_PATTERN.test(id)) fail(`${where} does not contain a session id (expected session_... or cse_...): "${id.slice(0, 60)}"`);
  return id;
}

// Shows only the start and end of a session id, so ids don't end up in logs or screenshots.
function maskId(id: string): string {
  const m = /^(session|cse)_(.+)$/.exec(id);
  if (!m || m[2].length < 10) return id.replace(/_.+$/, "_…");
  return `${m[1]}_${m[2].slice(0, 4)}…${m[2].slice(-3)}`;
}

function maskIdsIn(text: string): string {
  return text.replace(/\b(?:session|cse)_[A-Za-z0-9]+/g, (m) => maskId(m));
}

type Resolved = { id: string; source: string; route?: string; updatedAt?: string };

// `route` is the route name from --to (the default route when omitted). When a route name is
// given, DUET_SESSION_ID is never used: it would send to the wrong session.
async function resolveSessionId(route?: string): Promise<Resolved> {
  const direct = process.env.DUET_SESSION_ID?.trim();
  const fileId = process.env.DUET_ROUTES_FILE_ID?.trim();

  if (!fileId) {
    if (route !== undefined) fail(`--to ${route} needs the routes file: set DUET_ROUTES_FILE_ID (DUET_SESSION_ID has no routes)`);
    if (direct) return { id: parseId(direct, "DUET_SESSION_ID"), source: "DUET_SESSION_ID" };
    fail(
      "no destination: set DUET_ROUTES_FILE_ID to the Drive file id of your routes file (see the setup guide), or set DUET_SESSION_ID.",
    );
  }
  if (!FILE_ID_PATTERN.test(fileId)) fail("DUET_ROUTES_FILE_ID does not look like a Google Drive file id");

  const source = driveTitleRoutesSource(fileId);
  let routes;
  try {
    routes = await loadRoutes(source);
  } catch (e) {
    if (!(e instanceof RoutesError)) throw e;
    if (direct && route === undefined) {
      console.error(`duet: ${maskIdsIn(e.message).replace(/\.$/, "")}; using DUET_SESSION_ID instead.`);
      return { id: parseId(direct, "DUET_SESSION_ID"), source: "DUET_SESSION_ID (routes file unreadable)" };
    }
    fail(maskIdsIn(e.message));
  }
  try {
    const r = resolveRoute(routes, route);
    return { id: r.id, source: source.label, route: r.name, updatedAt: routes.updatedAt };
  } catch (e) {
    if (e instanceof RoutesError) fail(maskIdsIn(e.message));
    throw e;
  }
}

// ---------- claude CLI ----------
function resolveClaude(): string {
  const bin = process.env.DUET_CLAUDE_BIN ?? Bun.which("claude");
  if (!bin) fail("claude was not found (check PATH or set DUET_CLAUDE_BIN)");
  // npm's claude.cmd can only be started through cmd.exe, which could mangle the
  // message or interpret it as a command, so it is refused.
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    fail(
      `${bin} is a .cmd file and cannot be called safely. Install the native Claude Code (claude.exe) ` +
        "or point DUET_CLAUDE_BIN to claude.exe.",
    );
  }
  return bin;
}

function sanitize(text: string): string {
  // CRLF and lone CR become LF; then strip control characters except newline and tab
  return (
    text
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
  );
}

async function notifyDiscord(content: string) {
  const url = process.env.DUET_DISCORD_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
  } catch (e) {
    console.error(`duet: the Discord alert failed too: ${e}`);
  }
}

// ---------- Claude Code Stop hook ----------
// Docs: https://code.claude.com/docs/en/hooks (Stop, StopFailure)
type HookInput = {
  hook_event_name?: unknown;
  cwd?: unknown;
  stop_hook_active?: unknown;
  last_assistant_message?: unknown;
  background_tasks?: unknown;
  error?: unknown;
};

// Shortens text to at most `max` UTF-16 units (the unit MAX_LEN is counted in),
// ending with "…" when it was cut. A character is never split in half.
function clip(text: string, max: number): string {
  const clean = sanitize(text).trim();
  if (clean.length <= max) return clean;
  if (max < 1) return "";
  let kept = "";
  for (const ch of clean) {
    if (kept.length + ch.length > max - 1) break;
    kept += ch;
  }
  return `${kept.trimEnd()}…`;
}

// Builds the notification from the hook's JSON, or returns null when nothing should be sent.
async function hookMessage(): Promise<string | null> {
  // Set on the claude process this script starts, so a hook can never trigger itself.
  if (process.env.DUET_HOOK === "1") return null;
  if (process.stdin.isTTY) fail("--hook reads the hook's JSON on stdin. Claude Code provides it; to test, pipe a sample in.");

  let input: HookInput;
  try {
    input = JSON.parse(await new Response(Bun.stdin.stream()).text());
  } catch {
    fail("--hook expects the hook's JSON on stdin, but it could not be parsed.");
  }
  if (!input || typeof input !== "object") fail("--hook expects a JSON object on stdin.");
  // true when Claude is already continuing because of a Stop hook: that turn was notified already.
  if (input.stop_hook_active === true) return null;

  const event = typeof input.hook_event_name === "string" ? input.hook_event_name : "Stop";
  // Only the folder name, not the full path (which would include your user name).
  const folder = typeof input.cwd === "string" ? (input.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "") : "";
  const where = folder ? ` in ${folder}` : "";

  if (event === "StopFailure") {
    const err = typeof input.error === "string" ? ` (${clip(input.error, 60)})` : "";
    return `Claude Code stopped because of an API error${err}${where}.`;
  }

  let msg = event === "Stop" ? `Claude Code finished responding${where}.` : `Claude Code hook ${clip(event, 40)}${where}.`;
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) {
    const n = input.background_tasks.length;
    msg += ` ${n} background task${n === 1 ? " is" : "s are"} still running.`;
  }
  // The last message gets all the room left under MAX_LEN, and is cut off with "…" beyond that.
  const label = "\n\nLast message:\n";
  const room = MAX_LEN - sanitize(msg).length - label.length;
  const last = typeof input.last_assistant_message === "string" ? clip(input.last_assistant_message, room) : "";
  if (last) msg += `${label}${last}`;
  return msg;
}

// ---------- main ----------
// Set before parsing, so even an argument error exits 0 in hook mode.
hookMode = Bun.argv.slice(2).includes("--hook");
const args = parseArgs(Bun.argv.slice(2));
// In hook mode, status lines go to stderr so stdout stays free for Claude Code.
const log = hookMode ? console.error : console.log;

if (hookMode) {
  setTimeout(() => {
    console.error(`duet: the hook gave up after ${HOOK_TIMEOUT_MS / 1000} seconds`);
    for (const c of children) c.kill();
    exit(1);
  }, HOOK_TIMEOUT_MS).unref();
}

let text: string;
if (hookMode) {
  const built = await hookMessage();
  if (built === null) exit(0);
  text = built;
} else {
  text = args.text || (await readStdin());
}
if (!text) fail('the message is empty. Usage: bun run duet "message"', 2);

text = sanitize(text);
if (text.length > MAX_LEN) fail(`the message is too long (${text.length} characters, limit ${MAX_LEN})`);

// Prefix the tag. This also keeps a body starting with "-" from being read as a flag.
const defaultTag = hookMode ? HOOK_TAG : (process.env.DUET_TAG ?? DEFAULT_TAG);
const tag = sanitize(args.tag ?? defaultTag).trim() || DEFAULT_TAG;
const message = `${tag} ${text}`;

const { id, source, route, updatedAt } = await resolveSessionId(args.to);
// Checked before the dry run too, so a dry run fails the same way a real send would.
const claude = resolveClaude();
const shownId = args.verbose ? id : maskId(id);
const shownTo = route ? `${route} (${shownId})` : shownId;

if (args.dryRun) {
  console.log(
    `to: ${shownTo}\n(read from: ${source})\n${updatedAt ? `updated: ${updatedAt}\n` : ""}claude: ${claude}\nmessage:\n${message}`,
  );
  exit(0);
}

const proc = Bun.spawn([claude, "-p", message, "--cloud", id], {
  stdout: "pipe",
  stderr: "pipe",
  stdin: "ignore",
  // Marks this claude process, so a Stop hook running duet-send --hook skips it.
  env: { ...process.env, DUET_HOOK: "1" },
});
children.add(proc);
const [stdout, stderr, code] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

if (code === 0) {
  // claude prints the session id and its URL; show them only with --verbose.
  if (args.verbose && stdout.trim()) log(stdout.trim());
  log(`duet: sent to ${shownId}`);
  exit(0);
}

const raw = (stderr || stdout).trim().slice(0, 800);
const detail = args.verbose ? raw : maskIdsIn(raw);
console.error(`duet: sending failed (exit ${code})\n${detail}`);
await notifyDiscord(
  `duet-send: sending to Claude Duet failed (exit ${code}). The coordinator's session id may have changed.\n` +
    `to: ${route ? `${route} (${maskId(id)})` : maskId(id)}\n\`\`\`\n${maskIdsIn(raw)}\n\`\`\``,
);
exit(1);
