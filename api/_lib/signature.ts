import { createHmac, timingSafeEqual } from 'node:crypto';
export function signPayload(body: string | Uint8Array, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}
export function verifySignature(
  body: string | Uint8Array,
  secret: string,
  signature: string,
): boolean {
  if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  return timingSafeEqual(
    Buffer.from(signPayload(body, secret).slice(7), 'hex'),
    Buffer.from(signature.slice(7), 'hex'),
  );
}
