import type { WorkspaceRequest, WorkspaceResponse } from './workspace.js';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function header(req: WorkspaceRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}
export function enforceMutationOrigin(req: Pick<WorkspaceRequest, 'headers'>): void {
  const origin = header(req, 'origin');
  const host = header(req, 'host');
  if (!origin || !host || !/^[a-zA-Z0-9.:[\]-]+$/.test(host))
    throw new ApiError(403, 'Use this application to submit the request.');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  const scheme = local && header(req, 'x-forwarded-proto') !== 'https' ? 'http' : 'https';
  if (origin !== `${scheme}://${host}` || header(req, 'sec-fetch-site') === 'cross-site')
    throw new ApiError(403, 'Use this application to submit the request.');
  if (header(req, 'content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new ApiError(415, 'Content-Type must be application/json.');
}
export async function readJson(
  req: WorkspaceRequest,
  maxBytes = 65536,
): Promise<Record<string, unknown>> {
  const length = header(req, 'content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new ApiError(400, 'Request body is too large.');
  let body = req.body;
  if (body === undefined && req[Symbol.asyncIterator]) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
      const value = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
      size += value.byteLength;
      if (size > maxBytes) throw new ApiError(400, 'Request body is too large.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  let serialized: string | undefined;
  try {
    serialized = typeof body === 'string' ? body : JSON.stringify(body);
  } catch {
    throw new ApiError(400, 'Invalid JSON request.');
  }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > maxBytes)
    throw new ApiError(400, 'Invalid or oversized request body.');
  try {
    body = JSON.parse(serialized);
  } catch {
    throw new ApiError(400, 'Invalid JSON request.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'A JSON object is required.');
  return body as Record<string, unknown>;
}
export function sendJson(res: WorkspaceResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}
export function sendApiError(res: WorkspaceResponse, error: unknown): void {
  sendJson(res, error instanceof ApiError ? error.status : 503, {
    error:
      error instanceof ApiError
        ? error.message
        : 'Account services are temporarily unavailable. Please try again.',
  });
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function workspaceId(req: WorkspaceRequest): string {
  const id = header(req, 'x-workspace-id');
  if (!id || !UUID.test(id)) throw new ApiError(400, 'Choose a workspace first.');
  return id;
}
