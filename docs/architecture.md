# Architecture

The React client holds a random 256-bit workspace token in browser localStorage. It sends the token through the Authorization header; it is never embedded in an ingest URL. The database hashes the token for storage isolation. The server store persists JSON state and uses revision-based compare-and-swap updates to prevent lost writes. The Supabase publishable key is used only in server functions; row-level security scopes access to the workspace capability. Tokens are rotated client-side after six days and expire in storage after seven.

`src/domain.ts` owns validated commands and immutable transitions. `api/_lib/signature.ts` signs with native SHA256 HMAC and compares valid length digests with `timingSafeEqual`. Ingest disables Vercel body parsing and consumes the raw stream before verifying its UTF-8 JSON bytes. Payload size is bounded at 65,536 bytes. Oldest events are evicted to enforce 150 events and a 450 KB total state budget. Invalid signatures are retained for inspection but never reach the delivery simulator.

## API

- `GET /api/workspace`: returns `{state, revision}` for the bearer workspace.
- `POST /api/workspace`: JSON `{command}`; commands are `replay` with event ID, `advance-clock` with integer seconds 1–3600, `reset`, or validated synthetic `sample`.
- `POST /api/sample`: JSON `{raw, scenario, invalidSignature}`. Signs the raw payload server-side, verifies it, and atomically stores the capture.
- `POST /api/ingest`: raw valid JSON, bearer authentication, `X-Webhook-Signature`, optional `X-Delivery-Scenario`. Returns a receipt without exposing workspace state.

## Replay semantics

Initial delivery is attempt one. `success` always returns 200, `recover` returns 503 initially and 200 on the first replay, and `always-fail` returns 503. Latency is a deterministic fixture. Retry availability follows 30, 60, 120, … seconds, capped at one hour. The explicit workspace clock is frozen until advanced; a replay does not run itself. Replays are limited to twenty total attempts. An invalid signature cannot be replayed. Events already delivered cannot be replayed.

## Failure handling

A database failure produces an explicit error. The client changes displayed state only after a successful server response. An optional local demo is visibly labeled, memory-only, and cannot capture inbound HTTP. It never writes data into a claimed cloud cache. External clients should retry on 503; capture is not acknowledged when persistence fails.

## Security scope

The bearer token is access to the whole sandbox, including its demo signing secret. Local browser compromise is outside this MVP’s threat boundary. HMAC authenticates content but does not provide timestamp freshness or external idempotency. Do not use this sandbox as a production receiver. No arbitrary upstream request URLs are accepted, eliminating a forwarding/SSRF surface by construction. Retention bounds limit workspace size; global database quotas and abuse protection require operational controls before broad production use.
