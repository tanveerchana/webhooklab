# Verification record

Hosted browser workflows verified on 1 November 2026. This is an engineering portfolio application using synthetic demonstration data and simulated downstream delivery.

## Local quality checks

- `npm test`: **56 tests pass**, including shared storage/HTTP boundary cases.
- `npm run typecheck`: passes.
- `npm run format:check`: passes.
- `npm run build`: passes.

The checked-in GitHub Actions workflow runs installation, tests, types, formatting and a production build on pushes and pull requests. It does not deploy or receive production credentials.

## Hosted browser workflow check — 1 November 2026

Tested the live application at https://webhooklab-umber.vercel.app/ using a separate browser tab. The initial gate showed **Log in**, **Create account**, and an explicit **Try demo** action. Switching to Create account showed the twelve-character password and email-confirmation guidance; no credentials were entered and no signup was submitted.

Try demo opened the neutral, readable workspace with a demo label and a statement that account workspaces are separate. The initial retained-event count was 28. Through the hosted sample form, a synthetic `qa.hosted_recovery` event (`evt_bca05030b68d4b61`) was captured using the recover scenario. The inspector showed a verified signature, an initial simulated 503 response, and thirty seconds of retry backoff. Advancing the explicit simulation clock enabled replay. Manual replay produced 200 and preserved both attempts, including the initial failure and successful second attempt.

A full page reload retained the same event, its payload, Delivered status, 200 response, two attempts, and a total of 29 events. **Exit demo / Log in** restored the account gate without showing event data. Re-entering Try demo restored the saved demo workspace and recovered event. These observations establish the explicit demo/account UI boundary and persisted demo workflow; they do not establish an authenticated account-user journey.

Public browser navigation to `/api/auth` returned `{"user":null}`. `/api/team` and `/api/integrations` returned `{"error":"Sign in to open this workspace."}`. No deployment share link was created. The Vercel fetch helper was not used after automatic approval rejected its possible temporary sharing side effect; ordinary public browser reads supplied these observations instead.

The screenshot in [preview.jpg](preview.jpg) is an actual 89,570-byte hosted-browser JPEG captured after recovery persisted. It shows the neutral interface, demo toolbar, event table, and delivered-event inspector. No interface code or deployment was changed during this check; the only application-state writes were the synthetic demo capture, explicit clock advance, and manual replay.

The earlier signed-HTTP verification established that a raw request containing whitespace and Unicode escapes returned 202, changed bytes with the original signature returned 401, and malformed JSON returned 400. That earlier raw-ingestion check was not repeated during this browser-only pass.

## Account security verification

The account migration was applied to the hosted Supabase project on 31 October 2026. Rollback-only SQL assertions passed for cross-workspace/app isolation, viewer secret redaction and write denial, independent app-bound backend credentials, staff job transitions and financial isolation, owner-only membership management, verified-email invitation matching, membership removal, stale revisions, and scoped external ingestion. Two synthetic auth fixtures and all workspace fixtures were created inside the test transaction and rolled back; a follow-up query confirmed zero fixture rows remained.

The application requires both a verified provider session and current database membership. Account and demo transport tests prove that account requests cannot fall back to a demo token. Password exchange, refresh, cookie flags, same-origin checks, and error paths have injected-provider unit coverage. These tests do not establish real email delivery or a complete provider signup/confirmation/login browser run.

## Database boundary

The isolated PostgreSQL workspace table uses SHA-256 capability hashes, row-level security and an atomic revision compare-and-swap. An actual database role test verified owner reads, rejection of cross-token reads, rejection of reads without a token, and rejection of stale writes. Test changes were rolled back. Existing application tables were not changed.

Storage unit tests also exercise racing initialization, mutation conflicts, bounded retries, oversized bodies, invalid credentials and sanitized network errors. Those unit tests use an injected transport; they do not claim to be a hosted load test.

## Verification limits

Desktop demo workflows were exercised in the hosted browser. Responsive breakpoints and reduced-motion rules are implemented, but dedicated device testing was not performed. No real signup email, confirmation link, or full provider signup/confirmation/login journey was exercised. Authenticated owner/editor/viewer dashboard journeys and live integration-key management were not exercised through the browser in this pass. Database rollback tests and injected-provider unit coverage remain separate evidence. This is not a production security certification or real downstream delivery service. See the README for deliberate limits.
