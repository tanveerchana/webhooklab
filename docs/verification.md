# Verification record

Verified on 31 October 2026. This is an engineering portfolio demo using synthetic data.

## Local quality checks

- `npm test`: **29 tests pass**, including shared storage/HTTP boundary cases.
- `npm run typecheck`: passes.
- `npm run format:check`: passes.
- `npm run build`: passes.

The checked-in GitHub Actions workflow runs installation, tests, types, formatting and a production build on pushes and pull requests. It does not deploy or receive production credentials.

## Hosted workflow check

A real signed HTTP request containing whitespace and Unicode escapes returned 202. Changing the exact bytes while retaining the signature returned 401; malformed JSON returned 400. The capture history persisted. In the hosted browser, replay moved a failed simulated delivery from 503 to 200 and retained both attempts. Reload preserved the workspace. Charts derive their series from retained events.

Live demo: https://webhooklab-umber.vercel.app

## Database boundary

The isolated PostgreSQL workspace table uses SHA-256 capability hashes, row-level security and an atomic revision compare-and-swap. An actual database role test verified owner reads, rejection of cross-token reads, rejection of reads without a token, and rejection of stale writes. Test changes were rolled back. Existing application tables were not changed.

Storage unit tests also exercise racing initialization, mutation conflicts, bounded retries, oversized bodies, invalid credentials and sanitized network errors. Those unit tests use an injected transport; they do not claim to be a hosted load test.

## Verification limits

Desktop browser workflows were exercised manually. Responsive breakpoints and reduced-motion rules are implemented, but dedicated device testing was not performed. Speech recognition, where available, depends on the visitor's browser and was not exercised with a microphone. This demo is not a production security certification, payment integration or real customer operations system. See the README for deliberate limits.
