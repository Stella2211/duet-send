import { afterAll, describe, expect, test } from "bun:test";
import { RoutesError, googleDocsRoutesSource, loadRoutes, parseRoutes, resolveRoute } from "./routes";

const A = "session_01Abc123";
const B = "cse_01Xyz789";
const good = (over: object = {}) =>
  JSON.stringify({ version: 1, updated_at: "2026-11-23T03:30:00Z", default: "main", routes: { main: A, work: B }, ...over });

describe("parseRoutes", () => {
  test("valid", () => {
    const r = parseRoutes(good(), "f");
    expect(r.version).toBe(1);
    expect(r.updatedAt).toBe("2026-11-23T03:30:00Z");
    expect(r.default).toBe("main");
    expect([...r.routes.keys()]).toEqual(["main", "work"]);
  });
  test("updated_at is optional", () => {
    expect(parseRoutes(JSON.stringify({ version: 1, default: "a", routes: { a: A } }), "f").updatedAt).toBeUndefined();
  });
  test("BOM is stripped", () => {
    expect(parseRoutes("﻿" + good(), "f").default).toBe("main");
  });
  test("invalid JSON", () => {
    expect(() => parseRoutes("{nope", "myfile")).toThrow(/myfile is not valid JSON/);
  });
  test("not an object", () => {
    expect(() => parseRoutes("[]", "f")).toThrow(RoutesError);
  });
  test("wrong version", () => {
    expect(() => parseRoutes(good({ version: 2 }), "f")).toThrow("unsupported routes version 2, update duet-send");
  });
  test("missing or empty routes", () => {
    expect(() => parseRoutes(JSON.stringify({ version: 1, default: "a" }), "f")).toThrow(RoutesError);
    expect(() => parseRoutes(good({ routes: {} }), "f")).toThrow(RoutesError);
    expect(() => parseRoutes(good({ routes: [A] }), "f")).toThrow(RoutesError);
  });
  test("non-string value, without leaking values", () => {
    expect(() => parseRoutes(good({ routes: { main: 5 } }), "f")).toThrow(/route "main" must be a string/);
  });
  test("default missing or not in routes", () => {
    expect(() => parseRoutes(JSON.stringify({ version: 1, routes: { a: A } }), "f")).toThrow(/default/);
    expect(() => parseRoutes(good({ default: "zzz" }), "f")).toThrow(/not in "routes"/);
  });
  test("updated_at not a string", () => {
    expect(() => parseRoutes(good({ updated_at: 123 }), "f")).toThrow(/updated_at/);
  });
});

describe("resolveRoute", () => {
  const r = parseRoutes(good(), "f");
  test("default", () => expect(resolveRoute(r)).toEqual({ name: "main", id: A }));
  test("named", () => expect(resolveRoute(r, "work")).toEqual({ name: "work", id: B }));
  test("unknown route lists names", () => {
    expect(() => resolveRoute(r, "x")).toThrow('unknown route "x". Routes in the file: main (default), work');
  });
  test("invalid id", () => {
    const bad = parseRoutes(good({ routes: { main: "nope", work: B } }), "f");
    expect(() => resolveRoute(bad)).toThrow(/route "main"/);
    expect(() => resolveRoute(bad)).not.toThrow(/nope/);
  });
  test("id is trimmed", () => {
    const t = parseRoutes(good({ routes: { main: `  ${A}\n` } }), "f");
    expect(resolveRoute(t).id).toBe(A);
  });
});

describe("googleDocsRoutesSource", () => {
  const body = '﻿{"version":1,"default":"main","routes":{"main":"session_abc0123456789"}}\r\n';
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/document/d/public/export") return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (path === "/document/d/redirected/export") return Response.redirect("/signin", 302);
      if (path === "/signin") return new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html; charset=utf-8" } });
      if (path === "/document/d/private/export") return new Response("<!DOCTYPE html>", { status: 401, headers: { "content-type": "text/html" } });
      if (path === "/document/d/broken/export") return new Response("oops", { status: 500, headers: { "content-type": "text/plain" } });
      if (path === "/document/d/slow/export") return new Promise((r) => setTimeout(() => r(new Response(body)), 3000));
      if (path === "/document/d/curly/export") return new Response('{“version”:1}', { headers: { "content-type": "text/plain" } });
      return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    },
  });
  const origin = `http://localhost:${server.port}`;
  afterAll(() => server.stop(true));

  test("reads and parses a public document (BOM and CRLF removed)", async () => {
    const r = await loadRoutes(googleDocsRoutesSource("public", origin));
    expect(resolveRoute(r)).toEqual({ name: "main", id: "session_abc0123456789" });
  });

  for (const id of ["private", "redirected", "missing"]) {
    test(`a document that isn't shared by link (${id}) explains the sharing setting`, async () => {
      await expect(loadRoutes(googleDocsRoutesSource(id, origin))).rejects.toThrow(/Anyone with the link/);
    });
  }

  test("another HTTP error is reported with its status", async () => {
    await expect(loadRoutes(googleDocsRoutesSource("broken", origin))).rejects.toThrow(/HTTP 500/);
  });

  test("a slow answer times out", async () => {
    await expect(loadRoutes(googleDocsRoutesSource("slow", origin), 300)).rejects.toThrow(/timed out/);
  });

  test("curly quotes get a hint", async () => {
    await expect(loadRoutes(googleDocsRoutesSource("curly", origin))).rejects.toThrow(/curly quotes/);
  });

  test("an id with other characters is refused", () => {
    expect(() => googleDocsRoutesSource("a/b")).toThrow(RoutesError);
  });
});
