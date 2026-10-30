# WebhookLab design

WebhookLab is a focused webhook inspection and recovery workbench. Real inbound capture and isolated cloud persistence surround an explicitly simulated downstream delivery engine. A charcoal canvas, crisp type, mint feedback, thin dividers, and spacious inspector make operational information readable. Event status is always expressed in text as well as color. The responsive interface supports keyboard interaction, event searching, failure filtering, payload inspection, attempt history, sample delivery, JSON export, and reset.

## Implementation plan

1. Write and observe failing domain tests for JSON validation, HMAC failures, bounded retries, clock/backoff, and event filtering.
2. Implement typed domain engine, deterministic seed data, and Node HMAC helpers.
3. Integrate authenticated workspace persistence and raw inbound capture through Vercel API routes.
4. Build the responsive event console, setup panel, live sample sender, and recovery interactions.
5. Verify tests, TypeScript, production build, and browser behavior; document simulation boundaries and deployment configuration.
