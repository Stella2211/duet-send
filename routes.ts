// Routes table: a small JSON object that maps route names to session ids.
//   {"version":1,"updated_at":"...","default":"main","routes":{"main":"session_...","work":"session_..."}}

export class RoutesError extends Error {}

// Claude Code accepts both session_... and cse_... ids for `--cloud`.
export const ID_PATTERN = /^(session|cse)_[A-Za-z0-9]+$/;

export type Routes = { version: 1; updatedAt?: string; default: string; routes: Map<string, string> };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Error messages never include route values (session ids).
export function parseRoutes(text: string, where: string): Routes {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, "").trim());
  } catch {
    throw new RoutesError(`${where} is not valid JSON`);
  }
  if (!isPlainObject(data)) throw new RoutesError(`${where} must be a JSON object`);
  if (typeof data.version !== "number") throw new RoutesError(`${where} has no numeric "version"`);
  if (data.version !== 1) throw new RoutesError(`unsupported routes version ${data.version}, update duet-send`);
  if (!isPlainObject(data.routes) || Object.keys(data.routes).length === 0) {
    throw new RoutesError(`${where} needs a non-empty "routes" object`);
  }
  const routes = new Map<string, string>();
  for (const [name, value] of Object.entries(data.routes)) {
    if (typeof value !== "string") throw new RoutesError(`${where}: route "${name}" must be a string`);
    routes.set(name, value);
  }
  if (typeof data.default !== "string") throw new RoutesError(`${where} needs a string "default"`);
  if (!routes.has(data.default)) throw new RoutesError(`${where}: "default" is "${data.default}", which is not in "routes"`);
  if (data.updated_at !== undefined && typeof data.updated_at !== "string") {
    throw new RoutesError(`${where}: "updated_at" must be a string`);
  }
  return { version: 1, updatedAt: data.updated_at, default: data.default, routes };
}

export function resolveRoute(r: Routes, name?: string): { name: string; id: string } {
  const wanted = name ?? r.default;
  const raw = r.routes.get(wanted);
  if (raw === undefined) {
    const list = [...r.routes.keys()].map((k) => (k === r.default ? `${k} (default)` : k)).join(", ");
    throw new RoutesError(`unknown route "${wanted}". Routes in the file: ${list}`);
  }
  const id = raw.replace(/^\uFEFF/, "").trim();
  if (!ID_PATTERN.test(id)) {
    throw new RoutesError(`route "${wanted}" does not contain a session id (expected session_... or cse_...)`);
  }
  return { name: wanted, id };
}

// Where the routes text comes from.
export interface RoutesSource {
  label: string;
  load(signal: AbortSignal): Promise<string>;
}

// The routes table is the *name* (title) of one file in Google Drive, shared as
// "Anyone with the link: Viewer". Claude's Google Drive connector can rename a file but
// can't change its content, so the coordinator keeps the JSON in the name. Google's
// public download link reports the name in Content-Disposition without any sign-in;
// the content (a dummy) is never read.
export const FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DRIVE_ORIGIN = "https://drive.google.com";

// Header values arrive as bytes read one per character; a UTF-8 name (route names in
// Japanese, for example) is turned back into text here.
function utf8FromBytes(text: string): string {
  if (!/[\u0080-ÿ]/.test(text) || /[^\u0000-ÿ]/.test(text)) return text;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(text, (c) => c.charCodeAt(0)));
  } catch {
    return text;
  }
}

// Gets the file name out of a Content-Disposition header. filename* (RFC 5987/8187,
// percent-encoded) wins over filename. Google Drive sends filename="..." without escaping
// the quotes inside the name, so the quoted value runs to the last quote, not the first.
export function fileNameFromDisposition(header: string): string | null {
  const star = /(?:^|;)\s*filename\*\s*=\s*([^']*)'[^']*'([^;]*)/i.exec(header);
  if (star) {
    const charset = star[1].trim().toLowerCase();
    if (charset === "utf-8" || charset === "") {
      try {
        return decodeURIComponent(star[2].trim());
      } catch {}
    }
  }
  const at = /(?:^|;)\s*filename\s*=\s*/i.exec(header);
  if (!at) return null;
  let rest = header.slice(at.index + at[0].length);
  if (!rest.startsWith('"')) return utf8FromBytes(rest.split(";")[0].trim()) || null;
  rest = rest.slice(1);
  const nextParam = /";\s*[A-Za-z*-]+\s*=/.exec(rest);
  const end = nextParam ? nextParam.index : rest.lastIndexOf('"');
  let value = end >= 0 ? rest.slice(0, end) : rest;
  // A properly escaped quoted string (no bare quote inside): undo the escapes.
  if (!/(^|[^\\])"/.test(value)) value = value.replace(/\\(.)/g, "$1");
  return utf8FromBytes(value);
}

// Drive keeps an extension on the name (for example "{...}.json"), so only the part
// from the first "{" to the last "}" is the routes JSON.
export function routesJsonFromName(name: string): string {
  const start = name.indexOf("{");
  const end = name.lastIndexOf("}");
  return start >= 0 && end > start ? name.slice(start, end + 1) : name;
}

// `origin` is only for tests (a local stub server).
export function driveTitleRoutesSource(fileId: string, origin = DRIVE_ORIGIN): RoutesSource {
  if (!FILE_ID_PATTERN.test(fileId)) throw new RoutesError("the file id does not look like a Google Drive file id");
  const label = "the routes file (Google Drive)";
  return {
    label,
    async load(signal: AbortSignal): Promise<string> {
      const url = `${origin}/uc?export=download&id=${fileId}`;
      const res = await fetch(url, { signal, redirect: "follow" });
      const disposition = res.headers.get("content-disposition");
      // Only the header is needed; the content is a dummy.
      await res.body?.cancel().catch(() => {});
      const notShared =
        `could not read ${label} (HTTP ${res.status}). Check the file id, and that the file is shared as ` +
        `"Anyone with the link" with the Viewer role.`;
      // A file that isn't shared by link ends at a sign-in page (HTML, no file name).
      if (res.status === 401 || res.status === 403 || res.status === 404) throw new RoutesError(notShared);
      if (!res.ok) throw new RoutesError(`could not read ${label} (HTTP ${res.status})`);
      const name = disposition ? fileNameFromDisposition(disposition) : null;
      if (name === null) throw new RoutesError(notShared);
      return routesJsonFromName(name);
    },
  };
}

export async function loadRoutes(source: RoutesSource, timeoutMs = 15000): Promise<Routes> {
  const signal = AbortSignal.timeout(timeoutMs);
  let text: string;
  try {
    text = await source.load(signal);
  } catch (e) {
    if (e instanceof RoutesError) throw e;
    if (signal.aborted || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))) {
      throw new RoutesError(`timed out after ${Math.round(timeoutMs / 1000)} seconds reading ${source.label}`);
    }
    throw new RoutesError(`could not read ${source.label}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseRoutes(text, source.label);
}
