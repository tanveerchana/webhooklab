# Architecture

## Account access

`AccessRoot` provides explicit sign-in, sign-up, and demo entry, followed by workspace selection and role-aware team controls. Account authentication uses verified Supabase sessions in Secure, HttpOnly, SameSite cookies. Browser code never stores or reads account access or refresh tokens. Requests select an account workspace using `X-Workspace-Mode: account` and `X-Workspace-Id`; the server verifies the session and database membership independently.

The shared server account adapter loads current membership before each mutation and submits the command type to a database function that checks authorization again. Owners administer members and integrations, reset data, and rotate signing secrets. Editors can produce and replay events and read the signing secret. Viewers receive read-only state with the secret removed by the database and server response adapter. Same-origin checks and JSON content type are required for cookie-authenticated mutation routes.

## Demo isolation

Only explicitly selected demo mode creates or resolves a random 256-bit browser capability in localStorage. Demo calls use `X-Workspace-Mode: demo` and a bearer capability. Account calls remove bearer headers and use same-origin cookies. Switching mode or workspace remounts application state, preventing data from a previous workspace from appearing under a new selection. Demo capabilities rotate after six days and expire in storage after seven; they never authorize account access.

## Capture and delivery

`src/domain.ts` owns validated commands and immutable transitions. Ingest disables body parsing, reads the bounded raw stream, decodes UTF-8 strictly, and verifies native SHA256 HMAC over the original bytes with constant-time digest comparison. Invalid signatures are retained for inspection and never reach the simulator. Payloads are limited to 65,536 bytes; retention is bounded at 150 events and 450 KB of state.

Account ingestion uses a separate `whk_ingest_` capability plus `X-Workspace-Id`. Owner-only key creation returns the raw key once; browser state keeps it in memory only. The database stores its hash. Ingestion database functions additionally require a separate server-only backend key. An integration capability can capture events but cannot read or administer the account workspace. Demo HTTP ingestion remains a separate capability path.

Downstream processing is deterministic and in-process. No user-provided destination URL is requested. Initial delivery counts as attempt one. `success` returns 200; `recover` returns 503 initially and 200 on its first replay; `always-fail` returns 503. Latencies are simulator fixtures. Backoff is 30, 60, 120, … seconds, capped at one hour, evaluated against an explicitly advanced workspace clock. Replays require a user action and stop at twenty total attempts. Rejected and already delivered events cannot be replayed.

## Routes

| Route               | Purpose                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `/api/auth`         | Sign in, sign up, session lookup, sign out                                               |
| `/api/team`         | List and select workspaces; owner-managed invitations and roles                          |
| `/api/workspace`    | Read state and submit authorized commands                                                |
| `/api/sample`       | Authorized sample producer; signs, verifies, and atomically captures a synthetic request |
| `/api/integrations` | Read integration configuration; owner-only key rotation and revocation                   |
| `/api/ingest`       | Capture raw signed JSON with an account integration key or demo capability               |

Account writes use revision-based compare-and-swap to avoid lost updates. Capture returns a receipt without exposing stored workspace state. Database failures produce explicit errors; success is never acknowledged before storage commits. The interface does not silently substitute local data on a failed account request.

## Operational scope

HMAC authenticates bytes but does not provide timestamp freshness or external idempotency. This development workbench does not include production rate limiting, background retry workers, external delivery, or a full audit log. Global quotas and abuse controls are operational requirements before production use.
