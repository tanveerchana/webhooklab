# Interface design

WebhookLab uses a neutral application layout: light gray canvas, white panels, slate text, and blue action controls. Body text starts at 16 px, event rows use 14 px, supporting metadata stays at least 12 px, and controls have a 44 px minimum target. Panels align to an 8/16/24 px spacing scale. Status appears in text as well as muted color.

The primary workflow is a searchable event table beside an inspector with payload, metadata, and attempt tabs. On narrower screens the inspector stacks beneath the table. Manual replay explains backoff and exposes explicit simulation-clock advancement. Separate pages cover retained-event totals, endpoints and integration keys, replay history, and settings.

The account shell provides sign-in, sign-up, explicit demo entry, workspace selection, role display, and team management. Application controls follow shared permission helpers, while server and database authorization remain authoritative. Account state is remounted when mode or selected workspace changes. Signing secrets are hidden from viewer responses; integration keys are shown only in memory after owner-authorized creation.

The interface states that seeded events and downstream delivery are simulated. Inbound HTTP capture is real. No decorative trend charts, promotional panels, gradients, glows, or compact dashboard typography are used.
