#!/usr/bin/env bun
/**
 * duet-send: send a message to your Claude Duet coordinator (macOS / Windows)
 *
 *   bun run duet "message"
 *   echo "message" | bun run duet
 *   bun run duet --tag "[Discord bot]" "message"
 *   bun run duet --dry-run "message"   # print the target and body, send nothing
 *
 * The coordinator's session id is read from duet-coordinator-session-id.txt
 * in your Google Drive. Lookup order:
 *   1. DUET_ID_FILE (full path to the file)
 *   2. The Google Drive for desktop sync folder
 *      mac: ~/Library/CloudStorage/GoogleDrive-*\/{My Drive,マイドライブ}/
 *      win: <drive letter>:\{My Drive,マイドライブ}\  and  %USERPROFILE%\Google Drive\
 *   3. Google Workspace CLI (gws), downloading the file straight from Drive
 *      (for machines without Drive for desktop; needs DUET_DRIVE_FILE_ID)
 *   4. DUET_SESSION_ID (the id itself)
 *
 * If sending fails and DUET_DISCORD_WEBHOOK is set, a short alert is posted there.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const FILE_NAME = "duet-coordinator-session-id.txt";
const DRIVE_ROOTS = ["My Drive", "マイドライブ"];
// Claude Code accepts both session_... and cse_... ids for `--cloud`.
const ID_PATTERN = /^(session|cse)_[A-Za-z0-9]+$/;
const MAX_LEN = 8000;
const DEFAULT_TAG = "[Claude Code]";

function fail(msg: string, code = 1): never {
  console.error(`duet: ${msg}`);
  process.exit(code);
}

// ---------- arguments ----------
function parseArgs(argv: string[]) {
  let tag = process.env.DUET_TAG ?? DEFAULT_TAG;
  let dryRun = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tag") {
      tag = argv[++i] ?? fail("--tag needs a value");
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--help" || a === "-h") {
      console.log('usage: bun run duet [--tag "[name]"] [--dry-run] "message"   (or pipe the message on stdin)');
      process.exit(0);
    } else if (a === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    } else {
      rest.push(a);
    }
  }
  return { tag, dryRun, text: rest.join(" ") };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return (await new Response(Bun.stdin.stream()).text()).trim();
}

// ---------- where the session id lives ----------
function candidatePaths(): string[] {
  const out: string[] = [];
  const home = homedir();

  if (process.platform === "darwin") {
    const cloud = join(home, "Library", "CloudStorage");
    if (existsSync(cloud)) {
      for (const d of readdirSync(cloud)) {
        if (!d.startsWith("GoogleDrive-")) continue;
        for (const root of DRIVE_ROOTS) out.push(join(cloud, d, root, FILE_NAME));
      }
    }
    // legacy Backup and Sync location
    out.push(join(home, "Google Drive", FILE_NAME));
  } else if (process.platform === "win32") {
    // Drive for desktop uses G: by default; also try D-Z in case it was changed
    for (const letter of "GDEFHIJKLMNOPQRSTUVWXYZ") {
      for (const root of DRIVE_ROOTS) out.push(`${letter}:\\${root}\\${FILE_NAME}`);
    }
    out.push(join(home, "Google Drive", FILE_NAME));
    out.push(join(home, "My Drive", FILE_NAME));
  } else {
    out.push(join(home, "Google Drive", FILE_NAME));
  }
  return out;
}

function parseId(raw: string, where: string): string {
  const id = raw.replace(/^\uFEFF/, "").trim();
  if (!ID_PATTERN.test(id)) fail(`${where} does not contain a session id (expected session_... or cse_...): "${id.slice(0, 60)}"`);
  return id;
}

// Wrapper for launching npm's gws.cmd on Windows.
// Only fixed, validated arguments go through here (never the message body).
function cmdWrap(bin: string, args: string[]): string[] {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) return ["cmd.exe", "/d", "/s", "/c", bin, ...args];
  return [bin, ...args];
}

// Read the file straight from Drive with the Google Workspace CLI (https://github.com/googleworkspace/cli).
async function readViaGws(): Promise<string | null> {
  const gws = process.env.DUET_GWS_BIN ?? Bun.which("gws");
  if (!gws) return null;
  const fileId = process.env.DUET_DRIVE_FILE_ID?.trim();
  if (!fileId) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(fileId)) fail("DUET_DRIVE_FILE_ID does not look like a Drive file id");

  const dir = mkdtempSync(join(tmpdir(), "duet-"));
  const out = join(dir, FILE_NAME);
  try {
    const proc = Bun.spawn(
      cmdWrap(gws, ["drive", "files", "get", "--params", JSON.stringify({ fileId, alt: "media" }), "-o", out]),
      { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0 || !existsSync(out)) {
      console.error(`duet: gws could not download the file (exit ${code}) ${stderr.trim().slice(0, 300)}`);
      return null;
    }
    return parseId(readFileSync(out, "utf8"), `Drive file ${fileId}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function resolveSessionId(): Promise<{ id: string; source: string }> {
  const fromEnvFile = process.env.DUET_ID_FILE;
  const paths = fromEnvFile ? [fromEnvFile] : candidatePaths();

  for (const p of paths) {
    let raw: string;
    try {
      if (!existsSync(p)) continue;
      raw = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    return { id: parseId(raw, p), source: p };
  }

  if (!fromEnvFile) {
    const viaGws = await readViaGws();
    if (viaGws) return { id: viaGws, source: "gws (Google Drive)" };
  }

  const direct = process.env.DUET_SESSION_ID?.trim();
  if (direct) return { id: parseId(direct, "DUET_SESSION_ID"), source: "DUET_SESSION_ID" };

  fail(
    `${FILE_NAME} was not found. Install Google Drive for desktop, or set DUET_DRIVE_FILE_ID and install gws ` +
      "(Google Workspace CLI), or set DUET_ID_FILE / DUET_SESSION_ID.",
  );
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
  // strip control characters except newline and tab
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
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

// ---------- main ----------
const args = parseArgs(Bun.argv.slice(2));
let text = args.text || (await readStdin());
if (!text) fail('the message is empty. Usage: bun run duet "message"', 2);

text = sanitize(text);
if (text.length > MAX_LEN) fail(`the message is too long (${text.length} characters, limit ${MAX_LEN})`);

// Prefix the tag. This also keeps a body starting with "-" from being read as a flag.
const tag = sanitize(args.tag).trim() || DEFAULT_TAG;
const message = `${tag} ${text}`;

const { id, source } = await resolveSessionId();

if (args.dryRun) {
  console.log(`to: ${id}\n(read from: ${source})\nmessage:\n${message}`);
  process.exit(0);
}

const claude = resolveClaude();
const proc = Bun.spawn([claude, "-p", message, "--cloud", id], {
  stdout: "pipe",
  stderr: "pipe",
  stdin: "ignore",
});
const [stdout, stderr, code] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

if (code === 0) {
  if (stdout.trim()) console.log(stdout.trim());
  console.log("duet: sent");
  process.exit(0);
}

const detail = (stderr || stdout).trim().slice(0, 800);
console.error(`duet: sending failed (exit ${code})\n${detail}`);
await notifyDiscord(
  `duet-send: sending to Claude Duet failed (exit ${code}). The coordinator's session id may have changed.\n` +
    `to: ${id}\n\`\`\`\n${detail}\n\`\`\``,
);
process.exit(1);
