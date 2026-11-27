import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEND = join(import.meta.dir, "send.ts");
const MAX_LEN = 8000;
const TAG = "[Claude Code: Stop] ";

// The environment for a send.ts run: the current one without the variables send.ts reads,
// so a developer's own setup never leaks into a test; `over` sets what a test needs.
const DUET_VARS = ["DUET_TAG", "DUET_DISCORD_WEBHOOK", "DUET_ROUTES_FILE_ID", "DUET_SESSION_ID", "DUET_HOOK", "DUET_CLAUDE_BIN"];
function testEnv(over: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !DUET_VARS.includes(k)) env[k] = v;
  return { DUET_CLAUDE_BIN: process.execPath, ...env, ...over };
}

// Runs `send.ts --hook --dry-run` with a hook JSON on stdin. The routes file is unset and a
// dummy session id is used, so nothing is read from Google Drive and nothing is sent.
async function hookDryRun(input: object): Promise<string> {
  const proc = Bun.spawn([process.execPath, SEND, "--hook", "--dry-run"], {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
    env: testEnv({ DUET_SESSION_ID: "session_test0123456789" }),
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  const at = out.indexOf("message:\n");
  if (at < 0) throw new Error(`no message in the dry run.\nstdout: ${out}\nstderr: ${err}`);
  const message = out.slice(at + "message:\n".length).replace(/\n$/, "");
  expect(message.startsWith(TAG)).toBe(true);
  return message.slice(TAG.length);
}

const stop = (last: string, extra: object = {}) => ({ hook_event_name: "Stop", cwd: "/home/u/duet-send", last_assistant_message: last, ...extra });

describe("--hook: the last message", () => {
  test("a short reply is sent whole", async () => {
    const text = await hookDryRun(stop("All done."));
    expect(text).toBe("Claude Code finished responding in duet-send.\n\nLast message:\nAll done.");
  });

  test("a reply that just fits is not cut", async () => {
    const header = "Claude Code finished responding in duet-send.\n\nLast message:\n";
    const last = "a".repeat(MAX_LEN - header.length);
    const text = await hookDryRun(stop(last));
    expect(text).toBe(header + last);
    expect(text.length).toBe(MAX_LEN);
  });

  test("one character over the limit is cut, with …", async () => {
    const header = "Claude Code finished responding in duet-send.\n\nLast message:\n";
    const last = "a".repeat(MAX_LEN - header.length + 1);
    const text = await hookDryRun(stop(last));
    expect(text).toBe(`${header}${"a".repeat(MAX_LEN - header.length - 1)}…`);
  });

  test("a reply far past the old 500-character cut keeps its later part", async () => {
    const last = `${"x".repeat(3000)}[END]`;
    const text = await hookDryRun(stop(last));
    expect(text.endsWith("[END]")).toBe(true);
  });

  const cases: [string, string, object][] = [
    ["ASCII", "abcdefghij".repeat(2000), {}],
    ["Japanese", "あいうえおかきくけこ".repeat(2000), {}],
    ["emoji (two UTF-16 units each)", "😀".repeat(9000), {}],
    ["a long folder name and background tasks", "abcdefghij".repeat(2000), { cwd: `/home/u/${"f".repeat(200)}`, background_tasks: [{}, {}, {}] }],
  ];
  for (const [name, last, extra] of cases) {
    test(`a too-long ${name} reply is cut to the limit, ending with …`, async () => {
      const text = await hookDryRun(stop(last, extra));
      expect(text.length).toBeLessThanOrEqual(MAX_LEN);
      expect(text.length).toBeGreaterThanOrEqual(MAX_LEN - 1);
      expect(text.endsWith("…")).toBe(true);
      // never half of a surrogate pair
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)).toBe(false);
    });
  }
});

// Runs `send.ts --dry-run` with the given env overrides and returns the result.
async function dryRun(env: Record<string, string>, extra: string[] = []) {
  const proc = Bun.spawn([process.execPath, SEND, "--dry-run", ...extra, "hi"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: testEnv(env),
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { out, err, code: await proc.exited };
}

describe("destination", () => {
  test("no routes file and no DUET_SESSION_ID fails", async () => {
    const r = await dryRun({ DUET_ROUTES_FILE_ID: "", DUET_SESSION_ID: "" });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("no destination: set DUET_ROUTES_FILE_ID");
  });
  test("an invalid DUET_ROUTES_FILE_ID fails", async () => {
    const r = await dryRun({ DUET_ROUTES_FILE_ID: "a/b", DUET_SESSION_ID: "session_test0123456789" });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("DUET_ROUTES_FILE_ID does not look like a Google Drive file id");
  });
  test("--to without the routes file fails instead of using DUET_SESSION_ID", async () => {
    const r = await dryRun({ DUET_ROUTES_FILE_ID: "", DUET_SESSION_ID: "session_test0123456789" }, ["--to", "work"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("--to work needs the routes file");
    expect(r.out).not.toContain("to:");
  });
  test("--to needs a route name", async () => {
    const r = await dryRun({ DUET_ROUTES_FILE_ID: "", DUET_SESSION_ID: "session_test0123456789" }, ["--to", " "]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("--to needs a route name");
  });
});

// ---------- claude can't be started ----------
// A fake Discord webhook records the POST bodies. No real claude is ever started: the
// destination is a dummy session id and DUET_CLAUDE_BIN is missing or not executable.
const FULL_ID = "session_test0123456789";

async function runNoClaude(bin: string, extra: string[]) {
  const posts: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      posts.push(await req.text());
      return new Response(null, { status: 204 });
    },
  });
  try {
    const hook = extra.includes("--hook");
    const proc = Bun.spawn([process.execPath, SEND, ...extra, ...(hook ? [] : ["hi"])], {
      stdin: hook ? new Blob([JSON.stringify({ hook_event_name: "Stop", cwd: "/tmp/t", last_assistant_message: "x" })]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: testEnv({
        DUET_SESSION_ID: FULL_ID,
        DUET_CLAUDE_BIN: bin,
        DUET_DISCORD_WEBHOOK: `http://127.0.0.1:${server.port}/hook`,
      }),
    });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { out, err, code: await proc.exited, posts };
  } finally {
    await server.stop(true);
  }
}

describe("claude can't be started", () => {
  const missing = "/nonexistent/claude";

  test("--hook: exit 0, stderr says why, one Discord alert without the full id", async () => {
    const r = await runNoClaude(missing, ["--hook"]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("duet: claude was not found");
    expect(r.err).toContain(missing);
    expect(r.posts.length).toBe(1);
    const content = JSON.parse(r.posts[0]).content as string;
    expect(content).toContain("could not start Claude Code");
    expect(content).not.toContain(FULL_ID);
  });

  test("without --hook: exit 1, one Discord alert", async () => {
    const r = await runNoClaude(missing, []);
    expect(r.code).toBe(1);
    expect(r.posts.length).toBe(1);
    expect(JSON.parse(r.posts[0]).content).not.toContain(FULL_ID);
  });

  test("--dry-run: fails and posts nothing", async () => {
    const r = await runNoClaude(missing, ["--dry-run"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("claude was not found");
    expect(r.posts.length).toBe(0);
  });

  test.skipIf(process.platform === "win32")("a file that isn't executable: --hook exits 0, one alert", async () => {
    const dir = mkdtempSync(join(tmpdir(), "duet-send-test-"));
    try {
      const file = join(dir, "claude");
      writeFileSync(file, "#!/bin/sh\nexit 0\n");
      chmodSync(file, 0o644);
      const r = await runNoClaude(file, ["--hook"]);
      expect(r.code).toBe(0);
      expect(r.err).toContain("could not start claude");
      expect(r.posts.length).toBe(1);
      expect(JSON.parse(r.posts[0]).content).not.toContain(FULL_ID);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test.skipIf(process.platform === "win32")("the alert names only the file, even when the path looks like an id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "duet-send-test-"));
    try {
      const sub = join(dir, "cse_student01", "bin");
      mkdirSync(sub, { recursive: true });
      const file = join(sub, "claude");
      writeFileSync(file, "#!/bin/sh\nexit 0\n");
      chmodSync(file, 0o644);
      for (const bin of [file, join(dir, "cse_student01", "bin", "missing")]) {
        const r = await runNoClaude(bin, ["--hook"]);
        expect(r.code).toBe(0);
        expect(r.posts.length).toBe(1);
        const content = JSON.parse(r.posts[0]).content as string;
        expect(content).not.toContain(dir);
        expect(content).not.toContain("cse_");
        expect(content).not.toContain("/bin/");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------- the send path, with a fake claude ----------
// The fake records its arguments (NUL-separated) and DUET_HOOK, prints FAKE_STDOUT and
// FAKE_STDERR, and exits with FAKE_EXIT. A fake Discord webhook records the alerts.
// Nothing real is sent. POSIX only, like the "isn't executable" tests above.
const FAKE_CLAUDE = `#!/bin/sh
{ for a in "$@"; do printf '%s\\0' "$a"; done; } > "$FAKE_DIR/argv"
printf '%s' "$DUET_HOOK" > "$FAKE_DIR/hook"
printf '%s' "$FAKE_STDOUT"
printf '%s' "$FAKE_STDERR" >&2
exit "\${FAKE_EXIT:-0}"
`;

type FakeOpts = { routesTable?: object; webhookStatus?: number; args?: string[]; stdin?: object; env?: Record<string, string>; exit?: number; stdout?: string; stderr?: string };

async function runFake(o: FakeOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "duet-send-test-"));
  const posts: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      posts.push(await req.text());
      return new Response(null, { status: o.webhookStatus ?? 204 });
    },
  });
  const drive = o.routesTable
    ? Bun.serve({
        port: 0,
        fetch: () => new Response("dummy", { headers: { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(JSON.stringify(o.routesTable))}` } }),
      })
    : null;
  try {
    const bin = join(dir, "claude");
    writeFileSync(bin, FAKE_CLAUDE);
    chmodSync(bin, 0o755);
    const proc = Bun.spawn([process.execPath, ...(drive ? ["--preload", join(import.meta.dir, "fake-drive.preload.ts")] : []), SEND, ...(o.args ?? [])], {
      stdin: o.stdin ? new Blob([JSON.stringify(o.stdin)]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: testEnv({
        DUET_SESSION_ID: FULL_ID,
        DUET_CLAUDE_BIN: bin,
        DUET_DISCORD_WEBHOOK: `http://127.0.0.1:${server.port}/hook`,
        FAKE_DIR: dir,
        FAKE_EXIT: String(o.exit ?? 0),
        FAKE_STDOUT: o.stdout ?? "",
        FAKE_STDERR: o.stderr ?? "",
        ...(drive ? { DUET_ROUTES_FILE_ID: "testfile", FAKE_DRIVE_ORIGIN: `http://127.0.0.1:${drive.port}` } : {}),
        ...o.env,
      }),
    });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : null);
    const argv = read("argv");
    return { out, err, code, posts, argv: argv === null ? null : argv.split("\0").slice(0, -1), hookEnv: read("hook") };
  } finally {
    await server.stop(true);
    await drive?.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}

const hookInput = (extra: object = {}) => ({ hook_event_name: "Stop", cwd: "/tmp/proj", last_assistant_message: "done", ...extra });

describe.skipIf(process.platform === "win32")("sending", () => {
  test("starts claude with -p --cloud <id> -- <tag message>, marked DUET_HOOK=1", async () => {
    const r = await runFake({ args: ["hello"] });
    expect(r.code).toBe(0);
    expect(r.argv).toEqual(["-p", "--cloud", FULL_ID, "--", "[Claude Code] hello"]);
    expect(r.hookEnv).toBe("1");
  });

  test("success: one line with the masked id, exit 0, nothing on Discord", async () => {
    const r = await runFake({ args: ["hello"], stdout: "https://example.invalid/session_secret0123456789\n" });
    expect(r.code).toBe(0);
    expect(r.out).toBe("duet: sent to session_test…789\n");
    expect(r.out).not.toContain(FULL_ID);
    expect(r.posts.length).toBe(0);
  });

  test("success with a routes file names the route", async () => {
    const table = { version: 1, default: "main", routes: { main: "session_aaaa0123456789", work: "cse_bbbb0123456789" } };
    const a = await runFake({ args: ["hello"], routesTable: table });
    expect(a.out).toBe("duet: sent to main (session_aaaa…789)\n");
    const b = await runFake({ args: ["--to", "work", "hello"], routesTable: table });
    expect(b.out).toBe("duet: sent to work (cse_bbbb…789)\n");
    expect(b.argv?.slice(1, 3)).toEqual(["--cloud", "cse_bbbb0123456789"]);
  });

  test("--verbose shows the full id and claude's output", async () => {
    const r = await runFake({ args: ["--verbose", "hello"], stdout: "queued" });
    expect(r.out).toContain("queued");
    expect(r.out).toContain(`duet: sent to ${FULL_ID}`);
  });

  test("claude exits non-zero: exit 1, the id is masked in stderr, one alert", async () => {
    const r = await runFake({ args: ["hello"], exit: 3, stderr: `Session ${FULL_ID} is archived` });
    expect(r.code).toBe(1);
    expect(r.err).toContain("duet: sending failed (exit 3)");
    expect(r.err).toContain("session_test…789");
    expect(r.err).not.toContain(FULL_ID);
    expect(r.posts.length).toBe(1);
    const content = JSON.parse(r.posts[0]).content as string;
    expect(content).toContain("sending to Claude Duet failed (exit 3)");
    expect(content).not.toContain(FULL_ID);
  });

  test("the alert and stderr use masked ids, even after an underscore or letters", async () => {
    const r = await runFake({ args: ["hello"], exit: 1, stderr: "x_session_abcdefghijklmnop and cse_ZZZZ0123456789yy" });
    const content = JSON.parse(r.posts[0]).content as string;
    for (const text of [r.err, content]) {
      expect(text).not.toContain("abcdefghijklmnop");
      expect(text).not.toContain("ZZZZ0123456789yy");
      expect(text).toContain("session_abcd…nop");
    }
  });

  test("the alert replaces the home folder with ~", async () => {
    const r = await runFake({ args: ["hello"], exit: 1, stderr: "failed in /home/tester/.claude/x", env: { HOME: "/home/tester" } });
    const content = JSON.parse(r.posts[0]).content as string;
    expect(content).toContain("~/.claude/x");
    expect(content).not.toContain("/home/tester");
  });

  test("the home folder is shortened before ids are masked, so a home that looks like an id is replaced whole", async () => {
    const r = await runFake({ args: ["hello"], exit: 1, stderr: "failed in /home/session_abcdefghijkl/x", env: { HOME: "/home/session_abcdefghijkl" } });
    const content = JSON.parse(r.posts[0]).content as string;
    expect(content).toContain("failed in ~/x");
    expect(content).not.toContain("abcdefghijkl");
    expect(content).not.toContain("session_abcd");
  });

  test("the home folder is replaced only at a path boundary", async () => {
    const r = await runFake({ args: ["hello"], exit: 1, stderr: "in /home/al/x and /home/alice/y", env: { HOME: "/home/al" } });
    const content = JSON.parse(r.posts[0]).content as string;
    expect(content).toContain("in ~/x and /home/alice/y");
  });

  test("a Discord webhook that can't be reached is reported, without its URL", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response(null) });
    const port = closed.port;
    await closed.stop(true);
    const r = await runFake({ args: ["hello"], exit: 1, stderr: "boom", env: { DUET_DISCORD_WEBHOOK: `http://127.0.0.1:${port}/secret-token-path` } });
    expect(r.code).toBe(1);
    expect(r.err).toContain("duet: the Discord alert failed too:");
    expect(r.err).not.toContain("127.0.0.1");
    expect(r.err).not.toContain("secret-token-path");
  });

  test("whitespace-only stderr falls back to stdout", async () => {
    const r = await runFake({ args: ["hello"], exit: 1, stderr: "  \n", stdout: "the real reason" });
    expect(r.err).toContain("the real reason");
    expect(JSON.parse(r.posts[0]).content).toContain("the real reason");
  });

  test("cutting claude's output never splits a surrogate pair", async () => {
    const r = await runFake({ args: ["hello"], exit: 1, stderr: `a${"😀".repeat(500)}` });
    expect(r.err).not.toContain("\uFFFD");
    expect(JSON.parse(r.posts[0]).content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  test("a Discord webhook that answers with an error is reported, without its URL", async () => {
    const r = await runFake({ args: ["hello"], exit: 1, stderr: "boom", webhookStatus: 500 });
    expect(r.code).toBe(1);
    expect(r.err).toContain("duet: the Discord alert failed too: HTTP 500");
    expect(r.err).not.toContain("127.0.0.1");
  });

  test("--hook with a failing claude still exits 0", async () => {
    const r = await runFake({ args: ["--hook"], stdin: hookInput(), exit: 1, stderr: "boom" });
    expect(r.code).toBe(0);
    expect(r.err).toContain("sending failed");
  });

  test("--hook sends the Stop notification with the hook tag", async () => {
    const r = await runFake({ args: ["--hook"], stdin: hookInput() });
    expect(r.code).toBe(0);
    expect(r.argv?.[4]).toBe("[Claude Code: Stop] Claude Code finished responding in proj.\n\nLast message:\ndone");
    expect(r.hookEnv).toBe("1");
  });

  test("--hook sends the StopFailure text", async () => {
    const r = await runFake({ args: ["--hook"], stdin: hookInput({ hook_event_name: "StopFailure", error: "rate_limit" }) });
    expect(r.argv?.[4]).toBe("[Claude Code: Stop] Claude Code stopped because of an API error (rate_limit) in proj.");
  });

  test("--hook skips a turn that Claude continues because of a Stop hook", async () => {
    const r = await runFake({ args: ["--hook"], stdin: hookInput({ stop_hook_active: true }) });
    expect(r.code).toBe(0);
    expect(r.argv).toBeNull();
    expect(r.posts.length).toBe(0);
  });

  test("--hook skips when DUET_HOOK=1 is set (the hook can't trigger itself)", async () => {
    const r = await runFake({ args: ["--hook"], stdin: hookInput(), env: { DUET_HOOK: "1" } });
    expect(r.code).toBe(0);
    expect(r.argv).toBeNull();
  });

  test("a message over the limit: exit 1, claude never starts", async () => {
    const r = await runFake({ args: ["a".repeat(MAX_LEN + 1)] });
    expect(r.code).toBe(1);
    expect(r.err).toContain("the message is too long");
    expect(r.argv).toBeNull();
  });

  test("a message of exactly the limit is sent", async () => {
    const r = await runFake({ args: ["a".repeat(MAX_LEN)] });
    expect(r.code).toBe(0);
    expect(r.argv).not.toBeNull();
  });

  test("an empty message: exit 2, claude never starts", async () => {
    const r = await runFake({ args: [""] });
    expect(r.code).toBe(2);
    expect(r.err).toContain("the message is empty");
    expect(r.argv).toBeNull();
  });

  test("DUET_TAG sets the tag", async () => {
    const r = await runFake({ args: ["hello"], env: { DUET_TAG: "[Bot]" } });
    expect(r.argv?.[4]).toBe("[Bot] hello");
  });

  test("--tag wins over DUET_TAG", async () => {
    const r = await runFake({ args: ["--tag", "[Cli]", "hello"], env: { DUET_TAG: "[Bot]" } });
    expect(r.argv?.[4]).toBe("[Cli] hello");
  });

  test("a tag or message starting with - is passed after --, never as a claude option", async () => {
    const r = await runFake({ args: ["--tag", "--model", "--", "-5 tests failed"] });
    expect(r.code).toBe(0);
    expect(r.argv).toEqual(["-p", "--cloud", FULL_ID, "--", "--model -5 tests failed"]);
    const d = await runFake({ args: ["hello"], env: { DUET_TAG: "-x" } });
    expect(d.argv?.slice(-2)).toEqual(["--", "-x hello"]);
  });

  test("an empty or blank tag falls back to the default", async () => {
    for (const tag of ["", "   "]) {
      const r = await runFake({ args: ["hello"], env: { DUET_TAG: tag } });
      expect(r.argv?.[4]).toBe("[Claude Code] hello");
    }
  });
});

// ---------- arguments ----------
// No claude is started: either the run ends at an argument error, or it is a dry run.
async function runArgs(args: string[], stdin: string | null = null, env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, SEND, ...args], {
    stdin: stdin === null ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: testEnv({ DUET_SESSION_ID: FULL_ID, ...env }),
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { out, err, code: await proc.exited };
}
const messageOf = (out: string) => out.slice(out.indexOf("message:\n") + "message:\n".length).replace(/\n$/, "");

describe("arguments", () => {
  test("an unknown option is an error and nothing is sent", async () => {
    const r = await runArgs(["--dry-rnu", "hi"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("duet: unknown option --dry-rnu");
    expect(r.err).toContain('after "--"');
    expect(r.out).toBe("");
  });

  test("an unknown short option is an error too", async () => {
    const r = await runArgs(["--dry-run", "-x", "hi"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("unknown option -x");
  });

  test("an unknown option in hook mode exits 0", async () => {
    const r = await runArgs(["--hook", "--bogus"]);
    expect(r.code).toBe(0);
    expect(r.err).toContain("unknown option --bogus");
  });

  test("after -- text starting with - is the message", async () => {
    const r = await runArgs(["--dry-run", "--", "--dry-rnu", "hi"]);
    expect(r.code).toBe(0);
    expect(messageOf(r.out)).toBe("[Claude Code] --dry-rnu hi");
  });

  test("a lone - is plain text", async () => {
    const r = await runArgs(["--dry-run", "a", "-", "b"]);
    expect(r.code).toBe(0);
    expect(messageOf(r.out)).toBe("[Claude Code] a - b");
  });

  test("--tag=<value> and --to=<route> work", async () => {
    const r = await runArgs(["--dry-run", "--tag=[Bot]", "--to=work", "hi"]);
    // no routes file: the route is refused, which shows it was understood as --to
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("--to work needs the routes file");
    const t = await runArgs(["--dry-run", "--tag=[Bot]", "hi"]);
    expect(messageOf(t.out)).toBe("[Bot] hi");
  });

  test("--to= with no name is an error", async () => {
    const r = await runArgs(["--to=", "hi"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--to needs a route name");
  });

  test("--tag without a value is an error", async () => {
    const r = await runArgs(["hi", "--tag"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--tag needs a value");
  });

  test("whitespace-only text is empty: exit 2", async () => {
    const r = await runArgs(["  "]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("the message is empty");
  });

  test("whitespace-only text does not wait for stdin (open but never closed)", async () => {
    const proc = Bun.spawn([process.execPath, SEND, "--dry-run", "   "], {
      stdin: "pipe", // left open on purpose
      stdout: "pipe",
      stderr: "pipe",
      env: testEnv({ DUET_SESSION_ID: FULL_ID }),
    });
    const timer = setTimeout(() => proc.kill(), 4000);
    const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    expect(code).toBe(2);
    expect(err).toContain("the message is empty");
  });

  test("hook mode comes from the parsed arguments only", async () => {
    // after "--" it is message text, not an option
    const a = await runArgs(["--dry-run", "--", "--hook"]);
    expect(a.code).toBe(0);
    expect(messageOf(a.out)).toBe("[Claude Code] --hook");
    // as the value of --tag it is a tag
    const b = await runArgs(["--dry-run", "--tag", "--hook", "hi"]);
    expect(b.code).toBe(0);
    expect(messageOf(b.out)).toBe("--hook hi");
  });

  test("--help lists the options and the environment variables", async () => {
    const r = await runArgs(["--help"]);
    expect(r.code).toBe(0);
    for (const word of ["--dry-run", "--verbose", "--tag", "--to", "--hook", "  --  ", "DUET_ROUTES_FILE_ID", "DUET_SESSION_ID", "DUET_TAG", "DUET_DISCORD_WEBHOOK", "DUET_CLAUDE_BIN"]) {
      expect(r.out).toContain(word);
    }
  });
});

// ---------- the routes file ----------
// send.ts runs with fake-drive.preload.ts, which points Google Drive requests at a stub server
// that answers with the given file name in Content-Disposition.
const PRELOAD = join(import.meta.dir, "fake-drive.preload.ts");
const ID_A = "session_aaaa0123456789";
const ID_B = "session_bbbb0123456789";

async function runRoutes(table: object | string, args: string[], env: Record<string, string> = {}) {
  const name = typeof table === "string" ? table : JSON.stringify(table);
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("dummy", { headers: { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } }),
  });
  try {
    const proc = Bun.spawn([process.execPath, "--preload", PRELOAD, SEND, "--dry-run", ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: testEnv({ DUET_ROUTES_FILE_ID: "testfile", FAKE_DRIVE_ORIGIN: `http://127.0.0.1:${server.port}`, ...env }),
    });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { out, err, code: await proc.exited };
  } finally {
    await server.stop(true);
  }
}

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF\u2028\u2029]/;

describe("the routes file", () => {
  test("a route named by the file is shown as its default", async () => {
    const r = await runRoutes({ version: 1, updated_at: "2026-11-23", default: "main", routes: { main: ID_A } }, ["hi"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("to: main (session_aaaa…789)");
    expect(r.out).toContain("updated: 2026-11-23");
  });

  test("control and bidi characters in route names and updated_at are not printed", async () => {
    const evil = "ma\u001b[31min‮gnp\u0085";
    const r = await runRoutes({ version: 1, updated_at: "2026\u001b[2J-11\u009B", default: evil, routes: { [evil]: ID_A } }, ["hi"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(CONTROL);
    expect(r.out).toContain("to: ma[31mingnp (session_aaaa…789)");
    expect(r.out).toContain("updated: 2026[2J-11");
  });

  test("control characters in an error message are not printed", async () => {
    const r = await runRoutes({ version: 1, default: "ma\u001bin", routes: { "ma\u001bin": ID_A } }, ["--to", "x\u001by", "hi"]);
    expect(r.code).toBe(1);
    expect(r.err).not.toMatch(CONTROL);
    expect(r.err).toContain('unknown route "xy"');
    expect(r.err).toContain("main (default)");
  });

  test("zero-width characters are removed before ids are masked, so they can't hide an id", async () => {
    const r = await runRoutes({ version: 1, default: "main", routes: { main: ID_A } }, ["--to", "session_abcdefghijkl\u200Bmnop\u2028\uFEFFxyz", "hi"]);
    expect(r.code).toBe(1);
    expect(r.err).not.toMatch(CONTROL);
    expect(r.err).not.toContain("abcdefghijkl");
    expect(r.err).toContain("session_abcd…xyz");
  });

  test("a default route without a session id falls back to DUET_SESSION_ID, with a warning", async () => {
    const r = await runRoutes({ version: 1, default: "main", routes: { main: "not-an-id" } }, ["hi"], { DUET_SESSION_ID: ID_B });
    expect(r.code).toBe(0);
    expect(r.err).toContain('route "main" does not contain a session id');
    expect(r.err).toContain("using DUET_SESSION_ID instead");
    expect(r.out).toContain("to: session_bbbb…789");
  });

  test("a file name that isn't JSON falls back the same way", async () => {
    const r = await runRoutes("{nope", ["hi"], { DUET_SESSION_ID: ID_B });
    expect(r.code).toBe(0);
    expect(r.err).toContain("using DUET_SESSION_ID instead");
    expect(r.out).toContain("to: session_bbbb…789");
  });

  test("without DUET_SESSION_ID a default route without an id fails", async () => {
    const r = await runRoutes({ version: 1, default: "main", routes: { main: "not-an-id" } }, ["hi"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("does not contain a session id");
  });

  test("--to never falls back: an unknown route fails even with DUET_SESSION_ID", async () => {
    const r = await runRoutes({ version: 1, default: "main", routes: { main: ID_A } }, ["--to", "nope", "hi"], { DUET_SESSION_ID: ID_B });
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown route "nope"');
    expect(r.out).toBe("");
  });

  test("--to never falls back: a route without a session id fails even with DUET_SESSION_ID", async () => {
    const r = await runRoutes({ version: 1, default: "main", routes: { main: ID_A, work: "x" } }, ["--to", "work", "hi"], { DUET_SESSION_ID: ID_B });
    expect(r.code).toBe(1);
    expect(r.err).toContain('route "work" does not contain a session id');
  });
});
