# Isolated demo workspace persistence

The three applications each keep synthetic state in their own workspace. There is no anonymous shared mutable public workspace. This is a demo capability model, not production account authentication: no email is required; the browser creates 32 random bytes with Web Crypto, encodes them as 64 lowercase hexadecimal characters, and stores the resulting token locally. Anyone possessing the token can read or change its workspace. Do not put sensitive information here. Browser scripts running on an application's origin can read its token; use a dedicated origin and no untrusted scripts.

The frontend sends `Authorization: Bearer <token>` only to its own `/api/workspace`. The Node endpoint forwards that token to Supabase as `x-demo-token`, with a publishable API key. Neither the token nor the publishable key is an administrator credential. The database persists only the SHA-256 token hash. RLS authorizes the hash of the request header for both `anon` and `authenticated`, independently of account auth. Never log request authorization headers or tokens. Do not use service role or secret keys.

Set server environment variables `SUPABASE_URL=https://<project-ref>.supabase.co` and `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`. The server intentionally rejects non-Supabase origins, HTTP, redirects, credentials, URL paths, and secret/legacy key formats. Custom Supabase domains would require an explicit reviewed allowlist change. No database SDK is required.

Apply `schema.sql` once after inspecting its preflight. It creates only `public.portfolio_demo_workspaces`, its three RLS policies, and `public.portfolio_demo_cas`. It does not change existing application tables. It deliberately fails if a table with that name already exists. No migration was applied by this implementation.

Preflight (read-only, as project administrator):

```sql
select e.extname, n.nspname as extension_schema
from pg_catalog.pg_extension e
join pg_catalog.pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';
select has_schema_privilege('anon', 'extensions', 'USAGE'),
       has_schema_privilege('authenticated', 'extensions', 'USAGE');
select to_regclass('public.portfolio_demo_workspaces');
```

The migration assumes an existing pgcrypto installation under `extensions` and existing `anon`/`authenticated` USAGE on that schema, as standard Supabase projects provide. Its preflight refuses another extension schema. If inspection finds another schema, replace every qualified `extensions.digest` call with that verified schema; do not relocate an existing extension or grant broad permissions blindly. Verify that `public` is exposed by the Supabase Data API. The migration explicitly grants table SELECT/INSERT and only state/revision/updated_at UPDATE; no DELETE. RPC EXECUTE is revoked from PUBLIC then granted only to `anon` and `authenticated`. The RPC is SECURITY INVOKER, has an empty search_path, and always runs under the caller's RLS.

Workspaces expire seven days after creation. RLS hides expired data and disallows further updates. The browser should rotate its capability token at seven days or offer “new workspace” recovery after an expired token. A privileged scheduled maintenance job may eventually remove expired rows; it is intentionally not installed here. Domain reset commands replace state through the same CAS path and cannot delete rows or extend expiry.

`loadWorkspace(app, token, seed)` reads a token-isolated row, initializing it with compare-and-swap expected revision -1. A competing initializer is reloaded. `mutateWorkspace(app, token, seed, apply)` retries at most five times from freshly loaded JSON clones. Reducers must be deterministic: assign IDs, timestamps, and random values in the frontend command once, then validate them in the reducer; never generate new values during retries. Reducers may return raw state or an exact envelope with only `state` and optional `result` properties. If a domain state itself has that exact shape, wrap it explicitly as `{state: domainState}`. API output is `{state, revision, result?}`.

`createWorkspaceHandler` supports parsed/string request bodies and streamed Node requests. It rejects invalid tokens with 401, invalid commands/domain validation with 400, contention with 409, storage failures with a generic 503, and unsupported methods with 405. Request bodies are limited to 64 KB; database JSON state is limited to 512 KB; upstream responses and timeouts are bounded. Reducers should throw short user-facing `Error` messages for validation. GET/POST responses include `Cache-Control: no-store`. Database errors and network details are never returned.

## Verification

Run `npm test` from this directory. Tests inject fetch, not database administrator credentials, and cover initialization, optimistic updates, retry cloning, bounded contention, credentials, body validation, domain errors, and storage sanitization. These tests do not prove hosted RLS; run the database checks below after the approved migration is applied.

RLS/CAS smoke test in the SQL editor (all writes roll back; use only synthetic values):

```sql
begin;
set local role anon;
select set_config('request.headers', '{"x-demo-token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);
-- Expect ok=true revision=0 on a clean test workspace.
select public.portfolio_demo_cas('webhooklab', -1, '{"synthetic":true}');
-- Expect ok=false; seeding cannot overwrite an existing workspace.
select public.portfolio_demo_cas('webhooklab', -1, '{"synthetic":false}');
-- Expect ok=true revision=1, then ok=false for stale revision=0.
select public.portfolio_demo_cas('webhooklab', 0, '{"synthetic":true,"count":1}');
select public.portfolio_demo_cas('webhooklab', 0, '{"synthetic":true,"count":2}');
-- Expect one row for app webhooklab (or previously created rows for this token).
select app, revision from public.portfolio_demo_workspaces;
-- Another valid capability must not see the previous workspace.
select set_config('request.headers', '{"x-demo-token":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}', true);
select app, revision from public.portfolio_demo_workspaces; -- zero on a clean test
select public.portfolio_demo_cas('webhooklab', 1, '{"synthetic":false}'); -- ok=false
-- Missing/invalid headers cannot read anything.
select set_config('request.headers', '{}', true);
select count(*) from public.portfolio_demo_workspaces; -- 0
rollback;
```

Repeat with `set local role authenticated`. In separate rollback transactions, verify direct INSERT with a different token hash is rejected by RLS, DELETE is denied, UPDATE of `app`, `workspace_hash`, `created_at`, or `expires_at` is denied, invalid app and state above 524288 bytes are rejected, and expired rows are invisible. Also test REST with real `apikey` and two distinct `x-demo-token` headers so request-header propagation is verified, and run a concurrent pair of CAS writes with the same expected revision; exactly one should succeed. Inspect Supabase security advisors after installation.
