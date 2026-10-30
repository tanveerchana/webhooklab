import { ContentionError, loadWorkspace, mutateWorkspace, StorageError, type Reduction } from './store.js';

export interface WorkspaceRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
}
export interface WorkspaceResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}
const MAX_BODY = 64 * 1024;
function bodyBytes(value: unknown): number {
  let encoded: string | undefined;
  try { encoded = typeof value === 'string' ? value : JSON.stringify(value); } catch { throw new Error('Invalid request body.'); }
  return encoded === undefined ? 0 : new TextEncoder().encode(encoded).byteLength;
}
async function readCommand(req: WorkspaceRequest): Promise<Record<string, unknown>> {
  const length = req.headers['content-length'];
  if (typeof length === 'string' && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new Error('Request body must be at most 64 KB.');
  let body = req.body;
  if (body === undefined && req[Symbol.asyncIterator]) {
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
      const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      size += data.byteLength;
      if (size > MAX_BODY) throw new Error('Request body must be at most 64 KB.');
      chunks.push(data);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = new TextDecoder().decode(bytes);
  }
  if (bodyBytes(body) > MAX_BODY) throw new Error('Request body must be at most 64 KB.');
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { throw new Error('Invalid JSON request body.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A command is required.');
  const command: unknown = (body as {command?: unknown}).command;
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('A command is required.');
  const type = (command as {type?: unknown}).type;
  if (typeof type !== 'string' || !type.trim() || type.length > 100) throw new Error('A valid command type is required.');
  return command as Record<string, unknown>;
}
export function createWorkspaceHandler<T>(options: {app: string; seed: () => T; reduce: (state: T, command: any) => Reduction<T>}) {
  return async function handler(req: WorkspaceRequest, res: WorkspaceResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    const authorization = req.headers.authorization;
    const match = typeof authorization === 'string' ? /^Bearer ([a-f0-9]{64})$/.exec(authorization) : null;
    if (!match) { send(401, {error: 'A valid workspace token is required.'}); return; }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST'); send(405, {error: 'Method not allowed.'}); return;
    }
    try {
      if (req.method === 'GET') { send(200, await loadWorkspace(options.app, match[1], options.seed)); return; }
      const command = await readCommand(req);
      send(200, await mutateWorkspace(options.app, match[1], options.seed, state => options.reduce(state, command)));
    } catch (error) {
      if (error instanceof StorageError) { send(503, {error: error.message}); return; }
      if (error instanceof ContentionError) { send(409, {error: error.message}); return; }
      // Reducers throw short user-facing validation errors; infrastructure errors are normalized in store.ts.
      const message = error instanceof Error && error.message.length <= 250 ? error.message : 'The command could not be applied.';
      send(400, {error: message});
    }
  };
}
