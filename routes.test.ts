import { describe, expect, test } from "bun:test";
import { RoutesError, parseRoutes, resolveRoute } from "./routes";

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
