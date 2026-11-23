import { describe, expect, test } from "bun:test";

const SEND = new URL("./send.ts", import.meta.url).pathname;
const MAX_LEN = 8000;
const TAG = "[Claude Code: Stop] ";

// Runs `send.ts --hook --dry-run` with a hook JSON on stdin. the routes file is unset and a
// dummy session id is used, so nothing is read from Drive and nothing is sent.
async function hookDryRun(input: object): Promise<string> {
  const proc = Bun.spawn(["bun", SEND, "--hook", "--dry-run"], {
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DUET_ROUTES_FILE_ID: "", DUET_SESSION_ID: "session_test0123456789", DUET_CLAUDE_BIN: "claude", DUET_HOOK: "" },
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
async function dryRun(env: Record<string, string>) {
  const proc = Bun.spawn(["bun", SEND, "--dry-run", "hi"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DUET_CLAUDE_BIN: "claude", DUET_HOOK: "", ...env },
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
    expect(r.err).toContain("DUET_ROUTES_FILE_ID does not look like a Drive file id");
  });
});
