// Routes table: a small public JSON document that maps route names to session ids.
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
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
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

export function driveRoutesSource(fileId: string): RoutesSource {
  return {
    label: `Google Drive file ${fileId}`,
    async load(_signal: AbortSignal): Promise<string> {
      // TODO: fetch the public routes file here.
      throw new RoutesError("not implemented yet");
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
