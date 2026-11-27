import { afterAll, describe, expect, test } from "bun:test";
import { RoutesError, driveTitleRoutesSource, fileNameFromDisposition, loadRoutes, routesJsonFromName, parseRoutes, resolveRoute } from "./routes";

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

describe("fileNameFromDisposition", () => {
  const json = '{"version":1,"default":"main","routes":{"仕事":"session_abc"}}';
  test("filename* (UTF-8, percent-encoded) wins", () => {
    const h = `attachment; filename="x.json"; filename*=UTF-8''${encodeURIComponent(json)}`;
    expect(fileNameFromDisposition(h)).toBe(json);
  });
  test("a quoted filename with escaped quotes", () => {
    const h = `attachment; filename="${json.replace(/["\\]/g, "\\$&")}"`;
    expect(fileNameFromDisposition(h)).toBe(json);
  });
  test("Google Drive's unescaped quoted filename, with the extension Drive keeps", () => {
    const h = `attachment; filename="${json}.json"`;
    expect(routesJsonFromName(fileNameFromDisposition(h)!)).toBe(json);
  });
  test("raw UTF-8 bytes in a quoted filename", () => {
    const bytes = String.fromCharCode(...new TextEncoder().encode(json));
    expect(fileNameFromDisposition(`attachment; filename="${bytes}"`)).toBe(json);
  });
  test("a token filename", () => {
    expect(fileNameFromDisposition("attachment; filename=test.md")).toBe("test.md");
  });
  test("no filename", () => {
    expect(fileNameFromDisposition("attachment")).toBeNull();
  });
  test("an escaped quote before ; inside the name doesn't end it", () => {
    expect(fileNameFromDisposition('attachment; filename="a\\"; b=c.json"')).toBe('a"; b=c.json');
  });
  test("a quoted filename*=\"UTF-8''...\" is accepted", () => {
    const h = `attachment; filename*="UTF-8''${encodeURIComponent(json)}"`;
    expect(fileNameFromDisposition(h)).toBe(json);
  });
  test("filename* written inside the quoted name is ignored", () => {
    const json = '{"version":1,"x":"a;filename*=UTF-8\'\'evil"}';
    expect(fileNameFromDisposition(`attachment; filename="${json}.json"`)).toBe(`${json}.json`);
  });
  test("a real filename* after the quoted name wins", () => {
    expect(fileNameFromDisposition("attachment; filename=\"x\"; filename*=UTF-8''%E3%81%82.json")).toBe("あ.json");
  });
});

describe("driveTitleRoutesSource", () => {
  const title = '{"version":1,"updated_at":"2026-11-23T03:30:00Z","default":"main","routes":{"main":"session_abc0123456789"}}';
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (url.pathname === "/download") {
        return new Response("dummy content", {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": url.searchParams.get("id") === "star"
              ? `attachment; filename="routes.json"; filename*=UTF-8''${encodeURIComponent(title)}`
              : `attachment; filename="${title}.json"`,
          },
        });
      }
      if (url.pathname === "/signin") return new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname !== "/uc") return new Response("nope", { status: 404 });
      if (id === "public" || id === "star") return Response.redirect(`/download?id=${id}`, 303);
      if (id === "private") return Response.redirect("/signin", 302);
      if (id === "gone") return new Response("<!doctype html>", { status: 404, headers: { "content-type": "text/html" } });
      if (id === "broken") return new Response("oops", { status: 500 });
      if (id === "slow") return new Promise((r) => setTimeout(() => r(new Response("x")), 3000));
      if (id === "renamed") return new Response("x", { headers: { "content-disposition": 'attachment; filename="my notes.txt"' } });
      return new Response("nope", { status: 404 });
    },
  });
  const origin = `http://localhost:${server.port}`;
  afterAll(() => server.stop(true));

  test("reads the routes from the file name of a public file", async () => {
    const r = await loadRoutes(driveTitleRoutesSource("public", origin));
    expect(r.updatedAt).toBe("2026-11-23T03:30:00Z");
    expect(resolveRoute(r)).toEqual({ name: "main", id: "session_abc0123456789" });
  });

  test("also reads a filename* header", async () => {
    const r = await loadRoutes(driveTitleRoutesSource("star", origin));
    expect(resolveRoute(r).id).toBe("session_abc0123456789");
  });

  for (const id of ["private", "gone"]) {
    test(`a file that isn't shared by link (${id}) explains the sharing setting`, async () => {
      await expect(loadRoutes(driveTitleRoutesSource(id, origin))).rejects.toThrow(/Anyone with the link/);
      if (id === "private") {
        await expect(loadRoutes(driveTitleRoutesSource(id, origin))).rejects.toThrow(/returned a web page/);
      }
    });
  }

  test("another HTTP error is reported with its status", async () => {
    await expect(loadRoutes(driveTitleRoutesSource("broken", origin))).rejects.toThrow(/HTTP 500/);
  });

  test("a slow answer times out", async () => {
    await expect(loadRoutes(driveTitleRoutesSource("slow", origin), 300)).rejects.toThrow(/timed out/);
  });

  test("a file renamed by hand is not valid JSON", async () => {
    await expect(loadRoutes(driveTitleRoutesSource("renamed", origin))).rejects.toThrow(/not valid JSON/);
  });

  test("an id with other characters is refused", () => {
    expect(() => driveTitleRoutesSource("a/b")).toThrow(RoutesError);
  });
});
