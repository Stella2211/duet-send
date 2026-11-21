#!/usr/bin/env bun
/**
 * duet-send: send a message to your Claude Duet coordinator (macOS / Linux / Windows)
 *
 *   bun run duet "message"
 *   echo "message" | bun run duet
 *   bun run duet --tag "[Discord bot]" "message"
 *   bun run duet --dry-run "message"   # print the target and body, send nothing
 *   bun /path/to/send.ts --hook         # Claude Code Stop hook: reads the hook JSON on stdin
 *
 * The coordinator keeps its session id in the Drive *description* of
 * duet-coordinator-session-id.txt in the root of your My Drive (its Drive connector
 * can change a file's description but not its content). Lookup order:
 *   1. Google Workspace CLI (gws): reads the file's description straight from Drive,
 *      or its content when the description is empty (finds the file in your My Drive
 *      root, or uses DUET_DRIVE_FILE_ID if set)
 *   2. DUET_SESSION_ID (the id itself)
 * On macOS, gws is skipped while the login keychain is locked (see macKeychainLocked):
 * DUET_SESSION_ID is used if set, otherwise duet-send stops and asks to unlock it.
 *
 * If sending fails and DUET_DISCORD_WEBHOOK is set, a short alert is posted there.
 */
import { dlopen, FFIType, ptr } from "bun:ffi";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILE_NAME = "duet-coordinator-session-id.txt";
// Claude Code accepts both session_... and cse_... ids for `--cloud`.
const ID_PATTERN = /^(session|cse)_[A-Za-z0-9]+$/;
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
  let dryRun = false;
  let verbose = false;
  let hook = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") {
      tag = argv[++i] ?? fail("--tag needs a value");
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--verbose") {
      verbose = true;
    } else if (a === "--hook") {
      hook = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        'usage: bun run duet [--tag "[name]"] [--dry-run] [--verbose] "message"   (or pipe the message on stdin)\n' +
          "       bun /path/to/send.ts --hook [--tag \"[name]\"]   (Claude Code Stop hook; reads the hook JSON on stdin)",
      );
      process.exit(0);
    } else if (a === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    } else {
      rest.push(a);
    }
  }
  return { tag, dryRun, verbose, hook, text: rest.join(" ") };
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

// Wrapper for launching npm's gws.cmd on Windows.
// Only fixed or validated arguments go through here (never the message body).
function cmdWrap(bin: string, args: string[]): string[] {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) return ["cmd.exe", "/d", "/s", "/c", bin, ...args];
  return [bin, ...args];
}

// Read the file straight from Drive with the Google Workspace CLI (https://github.com/googleworkspace/cli).
// Only the file in the root of your own My Drive is accepted, so a file with the same
// name that someone else shared with you is never used.
// docs/setup-guide*.md show the same query for a manual check; keep them in sync.
const GWS_QUERY = `name = '${FILE_NAME}' and 'root' in parents and 'me' in owners and trashed = false`;
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

type GwsResult = { code: number; stdout: string; stderr: string };

async function runGws(gws: string, args: string[], cwd: string): Promise<GwsResult> {
  const proc = Bun.spawn(cmdWrap(gws, args), { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  children.add(proc);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

// gws prints a one-line error to stderr and a JSON error body to stdout.
// Its log lines (such as "Using keyring backend: keyring") are left out.
function gwsReason(r: GwsResult): string {
  const lines = r.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^using keyring backend/i.test(l));
  const errors = lines.filter((l) => /^error/i.test(l));
  const err = (errors.length ? errors : lines).join(" ");
  if (err) return err.slice(0, 400);
  try {
    const msg = JSON.parse(r.stdout)?.error?.message;
    if (msg) return String(msg).slice(0, 400);
  } catch {}
  return r.stdout.trim().slice(0, 400) || "(no output)";
}

type DriveFile = { id: string; description: string };

function driveFileFrom(json: { id?: unknown; description?: unknown } | undefined): DriveFile | null {
  const id = String(json?.id ?? "");
  if (!DRIVE_ID_PATTERN.test(id)) {
    console.error("duet: gws returned an unexpected file id");
    return null;
  }
  const description = typeof json?.description === "string" ? json.description : "";
  return { id, description };
}

// Finds the id file by name and returns its Drive file id and description in one call.
async function findDriveFile(gws: string, cwd: string): Promise<DriveFile | null> {
  const params = JSON.stringify({
    q: GWS_QUERY,
    orderBy: "modifiedTime desc",
    pageSize: 10,
    fields: "files(id,description)",
  });
  const r = await runGws(gws, ["drive", "files", "list", "--params", params], cwd);
  if (r.code !== 0) {
    console.error(`duet: gws could not search Drive for ${FILE_NAME} (exit ${r.code}): ${gwsReason(r)}`);
    return null;
  }
  let files: { id?: unknown; description?: unknown }[];
  try {
    files = JSON.parse(r.stdout)?.files ?? [];
  } catch {
    console.error(`duet: could not read the output of gws drive files list: ${r.stdout.trim().slice(0, 200)}`);
    return null;
  }
  if (files.length === 0) {
    console.error(
      `duet: gws found no ${FILE_NAME} in the root of your My Drive. ` +
        "Ask your Duet coordinator to create it, or set DUET_DRIVE_FILE_ID.",
    );
    return null;
  }
  if (files.length > 1) {
    console.error(
      `duet: warning: found ${files.length} files named ${FILE_NAME} in your My Drive; using the most recently modified one. ` +
        "Delete the old ones, or set DUET_DRIVE_FILE_ID.",
    );
  }
  return driveFileFrom(files[0]);
}

// Reads the description of the file named by DUET_DRIVE_FILE_ID.
async function getDriveFile(gws: string, fileId: string, cwd: string): Promise<DriveFile | null> {
  const params = JSON.stringify({ fileId, fields: "id,description" });
  const r = await runGws(gws, ["drive", "files", "get", "--params", params], cwd);
  if (r.code !== 0) {
    console.error(`duet: gws could not read Drive file ${fileId} (exit ${r.code}): ${gwsReason(r)}`);
    return null;
  }
  try {
    return driveFileFrom(JSON.parse(r.stdout));
  } catch {
    console.error(`duet: could not read the output of gws drive files get: ${r.stdout.trim().slice(0, 200)}`);
    return null;
  }
}

// Returns the session id and where it came from, or null after printing why it failed.
// The description is used first; the file content only when the description is empty,
// so setups made before the description was used keep working.
async function readViaGws(gws: string): Promise<{ id: string; source: string } | null> {
  const envId = process.env.DUET_DRIVE_FILE_ID?.trim();
  if (envId && !DRIVE_ID_PATTERN.test(envId)) fail("DUET_DRIVE_FILE_ID does not look like a Drive file id");

  // gws only writes --output inside its working directory, so run it in a temp dir
  // and pass a bare file name. realpath: on macOS the temp dir is behind a symlink.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "duet-")));
  try {
    const file = envId ? await getDriveFile(gws, envId, dir) : await findDriveFile(gws, dir);
    if (!file) return null;

    if (file.description.trim()) {
      const where = `the description of Drive file ${file.id}`;
      return { id: parseId(file.description, where), source: "gws (Google Drive, file description)" };
    }

    const r = await runGws(
      gws,
      ["drive", "files", "get", "--params", JSON.stringify({ fileId: file.id, alt: "media" }), "-o", FILE_NAME],
      dir,
    );
    const out = join(dir, FILE_NAME);
    if (r.code !== 0 || !existsSync(out)) {
      console.error(`duet: gws could not download the file (exit ${r.code}): ${gwsReason(r)}`);
      return null;
    }
    const content = readFileSync(out, "utf8");
    if (!content.replace(/^\uFEFF/, "").trim()) {
      console.error(
        `duet: both the description and the content of Drive file ${file.id} are empty. ` +
          "Ask your Duet coordinator to write its session id into the file's description.",
      );
      return null;
    }
    return { id: parseId(content, `Drive file ${file.id}`), source: "gws (Google Drive, file content)" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// On macOS, gws keeps the key for credentials.enc in the default (login) keychain. When gws
// runs while that keychain is locked (for example over SSH, or from a job outside the
// logged-in session), it treats credentials.enc as undecryptable, deletes it, and falls back
// to gcloud's Application Default Credentials, which have no Drive scope. So gws is not run then.
// `security show-keychain-info` is not used for this check: on a locked keychain it opens an
// unlock dialog and waits. SecKeychainGetStatus only reads the state and never prompts.
// Returns true only when the keychain is known to be locked; on any doubt it returns false
// and duet-send behaves as before.
const kSecUnlockStateStatus = 1;

function macKeychainLocked(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const sec = dlopen("/System/Library/Frameworks/Security.framework/Security", {
      SecKeychainCopyDefault: { args: [FFIType.ptr], returns: FFIType.i32 },
      SecKeychainGetStatus: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    });
    const cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
      CFRelease: { args: [FFIType.ptr], returns: FFIType.void },
    });
    try {
      const ref = new BigUint64Array(1);
      if (sec.symbols.SecKeychainCopyDefault(ptr(ref)) !== 0 || ref[0] === 0n) return false;
      const keychain = Number(ref[0]);
      try {
        const status = new Uint32Array(1);
        if (sec.symbols.SecKeychainGetStatus(keychain, ptr(status)) !== 0) return false;
        return (status[0] & kSecUnlockStateStatus) === 0;
      } finally {
        cf.symbols.CFRelease(keychain);
      }
    } finally {
      sec.close();
      cf.close();
    }
  } catch {
    return false;
  }
}

async function resolveSessionId(): Promise<{ id: string; source: string }> {
  const gws = process.env.DUET_GWS_BIN ?? Bun.which("gws");
  const direct = process.env.DUET_SESSION_ID?.trim();

  if (gws && macKeychainLocked()) {
    if (direct) {
      console.error("duet: the login keychain is locked, so gws is skipped and DUET_SESSION_ID is used.");
      return { id: parseId(direct, "DUET_SESSION_ID"), source: "DUET_SESSION_ID (login keychain locked, gws skipped)" };
    }
    fail(
      "the macOS login keychain is locked, so gws was not run (gws deletes its saved sign-in when it cannot read the keychain). " +
        "Unlock the keychain and try again: log in to this Mac, or run `security unlock-keychain` in this session. " +
        "Over SSH or in a background job, set DUET_SESSION_ID instead.",
    );
  }

  if (gws) {
    const viaGws = await readViaGws(gws);
    if (viaGws) return viaGws;
  }

  if (direct) return { id: parseId(direct, "DUET_SESSION_ID"), source: "DUET_SESSION_ID" };

  if (gws) fail("could not get the session id: gws failed (see above).");
  fail("gws (Google Workspace CLI) was not found. Install it (see the setup guide), set DUET_GWS_BIN, or set DUET_SESSION_ID.");
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

const { id, source } = await resolveSessionId();
// Checked before the dry run too, so a dry run fails the same way a real send would.
const claude = resolveClaude();
const shownId = args.verbose ? id : maskId(id);

if (args.dryRun) {
  console.log(`to: ${shownId}\n(read from: ${source})\nclaude: ${claude}\nmessage:\n${message}`);
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
    `to: ${maskId(id)}\n\`\`\`\n${maskIdsIn(raw)}\n\`\`\``,
);
exit(1);
