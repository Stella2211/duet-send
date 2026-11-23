import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEND = new URL("./send.ts", import.meta.url).pathname;
const MAX_LEN = 8000;
const TAG = "[Claude Code: Stop] ";

// Runs `send.ts --hook --dry-run` with a hook JSON on stdin. The routes file is unset and a
// dummy session id is used, so nothing is read from Google Drive and nothing is sent.
async function hookDryRun(input: object): Promise<string> {
  const proc = Bun.spawn(["bun", SEND, "--hook", "--dry-run"], {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DUET_ROUTES_FILE_ID: "", DUET_SESSION_ID: "session_test0123456789", DUET_CLAUDE_BIN: process.execPath, DUET_HOOK: "" },
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
  const proc = Bun.spawn(["bun", SEND, "--dry-run", ...extra, "hi"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DUET_CLAUDE_BIN: process.execPath, DUET_HOOK: "", ...env },
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
    const proc = Bun.spawn(["bun", SEND, ...extra, ...(hook ? [] : ["hi"])], {
      stdin: hook ? new Blob([JSON.stringify({ hook_event_name: "Stop", cwd: "/tmp/t", last_assistant_message: "x" })]) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        DUET_ROUTES_FILE_ID: "",
        DUET_SESSION_ID: FULL_ID,
        DUET_CLAUDE_BIN: bin,
        DUET_HOOK: "",
        DUET_DISCORD_WEBHOOK: `http://127.0.0.1:${server.port}/hook`,
      },
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
});
