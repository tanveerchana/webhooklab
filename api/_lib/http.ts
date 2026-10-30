import type { IncomingMessage, ServerResponse } from 'node:http';
export type ApiRequest = IncomingMessage & { body?: unknown };
export type ApiResponse = ServerResponse;
export function json(res: ApiResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}
export function bearer(req: ApiRequest): string {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '');
  if (!match) throw new Error('A valid workspace bearer token is required.');
  return match[1];
}
export async function readRaw(req: ApiRequest): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 65536) throw new Error('Payload must be at most 64 KB.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
