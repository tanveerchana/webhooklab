# WebhookLab

[Open application](https://webhooklab-umber.vercel.app) · [Architecture](docs/architecture.md) · [Verification record](docs/verification.md)

A webhook inspection and recovery workbench by [Tanveer Singh](https://singhtanveer.com). The interface uses a readable neutral layout with an event table, payload inspector, and manual replay history.

## Accounts and permissions

Sign up or sign in with email and password, then select an account workspace. Workspace owners manage team invitations and roles. Account sessions use server-verified Supabase authentication and secure HttpOnly cookies; account access and refresh tokens are never exposed to browser JavaScript or stored in localStorage.

| Action                                           | Owner | Editor | Viewer |
| ------------------------------------------------ | ----- | ------ | ------ |
| Read events, inspect payloads, export JSON       | Yes   | Yes    | Yes    |
| Send samples, replay failures, advance clock     | Yes   | Yes    | No     |
| Read signing secret and integration instructions | Yes   | Yes    | No     |
| Create, rotate, revoke inbound integration key   | Yes   | No     | No     |
| Reset workspace and rotate signing secret        | Yes   | No     | No     |
| Manage members and invitations                   | Yes   | No     | No     |

Permissions are enforced by server handlers and database functions. Hiding a control is an additional interface affordance. Viewer responses omit the signing secret. Cookie-authenticated mutations require a same-origin JSON request. A separate **Try demo** mode uses isolated synthetic data and a browser capability; it does not grant access to account workspaces.

## Features

- Real inbound HTTP capture with HMAC-SHA256 verification of the exact request bytes.
- Persistent account workspaces with membership-based access and revision-based concurrency control.
- Search and status filters over retained event types, IDs, sources, and payloads.
- JSON payload inspection, capture metadata, and complete simulated attempt history.
- Signed API samples with configurable failure scenarios and intentional invalid-signature tests.
- Manual replay with exponential backoff, an explicit simulated clock, and twenty total attempts per event.
- JSON event export and owner-authorized reset.

Inbound capture, persistence, authentication, and signature verification are real. **Downstream delivery is simulated.** No arbitrary URL is requested. Seed events are synthetic, response times are simulator values, and replays run only when requested. There is no background retry worker or real downstream forwarding.

## Run and verify

```sh
npm ci
npm test
npm run typecheck
npm run format:check
npm run build
npm run dev
```

Vite serves the frontend at `http://127.0.0.1:5101`. Use `vercel dev` to run server routes with the required environment. Plain Vite does not provide `/api` endpoints. API or database failures remain visible; the client does not silently replace saved account data with an offline demo.

Deploy as a Vite application with build command `npm run build` and output directory `dist`. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and server-only `PORTFOLIO_BACKEND_KEY`. Apply the account schema and row-level security setup supplied with the backend. Do not prefix backend environment variables with `VITE_`. No Supabase service-role key is required by this application.

## External account ingestion

An owner creates a scoped key under **Endpoints → Create integration key**. A key can capture events only; it cannot read dashboard data or manage a workspace. Creation or rotation returns the raw key once. The interface keeps it only in page memory. Rotation invalidates the previous key, and an owner may revoke the active key.

Open **Connect endpoint** for a runnable Node.js example. Account requests use:

```http
POST /api/ingest
Authorization: Bearer whk_ingest_<64-lowercase-hex-characters>
X-Workspace-Id: <account-workspace-uuid>
Content-Type: application/json
X-Webhook-Signature: sha256=<HMAC-SHA256-of-exact-body>
X-Delivery-Scenario: recover
```

The backend checks the scoped key and workspace before mutating account state. A separate server credential protects the ingestion database functions. Account session cookies are never copied into examples. Demo ingestion instead accepts its own 64-character browser capability and never selects an account workspace.

`X-Delivery-Scenario` is optional: `success`, `recover`, or `always-fail`. Payloads must be valid UTF-8 JSON, at most 64 KB. Valid signed captures return `202`. Invalid signatures are retained as rejected events and return `401`; malformed JSON returns `400` without an event. Refresh the feed after an external request.

## Retention and limits

The application retains up to 150 events within a 450 KB state budget, evicting oldest events first. Each event has at most twenty delivery attempts. Demo capabilities rotate after six days and expire in storage after seven; account sessions use the authentication provider’s server-verified lifecycle.

This development workbench does not claim webhook timestamp freshness checks, external idempotency, production rate limiting, a job scheduler, or real network latency measurements. Avoid sending sensitive production payloads.

## Stack

React · TypeScript · Vite · Vercel Node.js functions · Supabase Auth and PostgreSQL · native Node crypto · Lucide icons.

[Portfolio](https://singhtanveer.com) · [GitHub](https://github.com/tanveerchana)
