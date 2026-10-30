/** Demo-only capability storage. Never log tokens or include them in errors. */
export type Workspace<T> = { state: T; revision: number; result?: unknown };
export type Reduction<T> = T | { state: T; result?: unknown };
const APPS = new Set(['webhooklab', 'fieldpilot', 'payroute']);
const TOKEN = /^[a-f0-9]{64}$/;
const MAX_BYTES = 512 * 1024;
export class StorageError extends Error {
  constructor() { super('Workspace storage is temporarily unavailable. Please try again.'); this.name = 'StorageError'; }
}
export class ContentionError extends Error {
  constructor() { super('The workspace changed while saving. Please try again.'); this.name = 'ContentionError'; }
}
function config(app: string, token: string) {
  if (!APPS.has(app) || !TOKEN.test(token)) throw new StorageError();
  let url: URL;
  try { url = new URL(process.env.SUPABASE_URL ?? ''); } catch { throw new StorageError(); }
  // A project-specific Supabase origin prevents a bad env value from forwarding a capability elsewhere.
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new StorageError();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || key.length > 512) throw new StorageError();
  return {base: url.origin, headers: {'apikey': key, 'x-demo-token': token, 'Content-Type': 'application/json'}};
}
function clone<T>(value: T): T {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { throw new Error('Workspace state must contain JSON data.'); }
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > MAX_BYTES) throw new Error('Workspace state is too large.');
  return JSON.parse(encoded) as T;
}
function validRow<T>(value: unknown): value is Workspace<T> {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(row, 'state') && Number.isSafeInteger(row.revision) && Number(row.revision) >= 0;
}
async function request<T>(app: string, token: string, path: string, body?: unknown): Promise<T> {
  const {base, headers} = config(app, token);
  try {
    const response = await fetch(base + '/rest/v1/' + path, {
      method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new StorageError();
    // Responses are bounded independently from outbound state and HTTP request sizes.
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 2 * MAX_BYTES) throw new StorageError();
    if (!response.body) throw new StorageError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * MAX_BYTES) { await reader.cancel(); throw new StorageError(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(joined)) as T;
  } catch { throw new StorageError(); }
}
async function read<T>(app: string, token: string): Promise<Workspace<T> | undefined> {
  const rows = await request<unknown>(app, token, `portfolio_demo_workspaces?app=eq.${encodeURIComponent(app)}&select=state,revision&limit=1`);
  if (!Array.isArray(rows) || rows.length > 1) throw new StorageError();
  if (!rows.length) return undefined;
  if (!validRow<T>(rows[0])) throw new StorageError();
  try { return {state: clone(rows[0].state), revision: rows[0].revision}; } catch { throw new StorageError(); }
}
async function cas<T>(app: string, token: string, expected: number, state: T): Promise<Workspace<T> | undefined> {
  const value = await request<unknown>(app, token, 'rpc/portfolio_demo_cas', {p_app: app, p_expected_revision: expected, p_state: clone(state)});
  if (!value || typeof value !== 'object' || typeof (value as {ok?: unknown}).ok !== 'boolean') throw new StorageError();
  if (!(value as {ok: boolean}).ok) return undefined;
  if (!validRow<T>(value) || value.revision !== expected + 1) throw new StorageError();
  try { return {state: clone(value.state), revision: value.revision}; } catch { throw new StorageError(); }
}
export async function loadWorkspace<T>(app: string, token: string, seed: () => T): Promise<Workspace<T>> {
  const existing = await read<T>(app, token);
  if (existing) return existing;
  const created = await cas(app, token, -1, seed());
  if (created) return created;
  const concurrent = await read<T>(app, token);
  if (concurrent) return concurrent;
  throw new ContentionError();
}
/** Only the exact {state, result?} shape is an envelope; other objects are raw domain state. */
function unpack<T>(value: Reduction<T>): {state: T; result?: unknown} {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (Object.prototype.hasOwnProperty.call(value, 'state') && keys.every(key => key === 'state' || key === 'result')) return value as {state: T; result?: unknown};
  }
  return {state: value as T};
}
export async function mutateWorkspace<T>(app: string, token: string, seed: () => T, apply: (state: T) => Reduction<T>): Promise<Workspace<T>> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await loadWorkspace(app, token, seed);
    // A reducer may mutate its input. Every attempt gets an independent JSON clone.
    const reduced = unpack(apply(clone(before.state)));
    const saved = await cas(app, token, before.revision, reduced.state);
    if (saved) return Object.prototype.hasOwnProperty.call(reduced, 'result') ? {...saved, result: reduced.result} : saved;
  }
  throw new ContentionError();
}
