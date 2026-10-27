# Asa Ride completion and launch checklist

Updated 27 October 2026. The approved application implementation is complete. Launch configuration
and live checks remain below. See [HANDOVER.md](HANDOVER.md), [plan.md](plan.md), and
[RUNBOOK.md](RUNBOOK.md) for decisions and evidence.

## Implemented and checked locally

- [x] Connected customer/admin portals, navigation, private details, and phone-sized layouts.
- [x] Email-based pending ride requests without signup; private one-use email links and expiring
      history sessions, including rejected requests; older phone-only records preserved.
- [x] Imported 27 research locations and 351 pairs as 702 editable directional draft routes,
      retaining provenance. Admin publishing, distance edits, default/fixed pricing, and previews.
- [x] Area pricing approved 27 October: create/edit areas, one area per route, clear an area rate to
      use the default, and preview the applicable rate. Fixed prices take priority; upward ₦50
      rounding and immutable saved booking prices remain. Existing routes/records migrate safely.
- [x] Google Calendar linking approved 27 October with blank configuration for later setup: admin
      connection/calendar selection, encrypted offline tokens, private pickup markers, atomic update
      queue, stable event IDs, reschedule/cancellation, failures/retries and disconnect. Verified
      against an isolated Google simulation; no real Google account is connected.
- [x] Server-calculated upward ₦50 rounding, exact decimal rates, renewed consent on a changed quote,
      and immutable quote/offer/agreed-price snapshots.
- [x] One negotiation offer with one admin acceptance/rejection; rejection reasons; cancellation
      and pickup/arrival/completion; actor/time audit history and repeated-action protection.
- [x] Owner-approved pickup-time expiry with “Not accepted before pickup time.” System audit,
      durable notifications, history update, startup catch-up, and no automatic confirmation.
- [x] Admin search, status/date filters, pagination, details, operating windows, closures/reopening,
      reasoned rescheduling, revision protection, and possible same-day conflict review/override.
- [x] Persistent email recipients/event switches/text; delivery/attempt records, filters, safe retries,
      interrupted-send recovery, stale-update and idempotency-window protection.
- [x] Native Resend transport, stable keys, sender snapshots, signed callbacks, duplicate/out-of-order
      events, and separate accepted/delivered/delayed/bounced/complained/failure states.
- [x] Optional WhatsApp opt-in/number and opt-out, separate admin controls, durable delivery records,
      an authenticated HTTPS adapter interface, and safe retries. Starts disabled; legacy phone
      numbers never imply consent. Real provider setup remains optional launch work.
- [x] Strong production admin password checks, same-origin SPA/API hosting, security headers,
      SQLite-backed API/login limits, explicit proxy trust, redacted request logs, and health checks.
- [x] Private verified live-WAL snapshots, automatic local backups/retention, atomic publication of
      completed backups, and restore-to-new-file protection. Manual backup and restore checked.
- [x] Deployment/HTTPS/persistent-volume configuration, sample production environment, admin operating
      guide, monitoring and recovery/rollback instructions. Container build/deployment remain unverified.
- [x] Manual desktop/mobile customer/admin journey with isolated fake providers; no real messages sent.
- [x] Updated obsolete tests and ran the regression suite with explicit owner permission. After
      calendar linking on 27 October, 79 tests passed across eleven files. Formatting and lint also passed.
      No builds/typecheck builds run.

## Before launch — configuration and live verification

- [ ] Review research distances and publish only served routes. Set approved default/fixed prices,
      locations, hours, closures, dispatch recipients, and actual operating contact information.
- [ ] Configure the chosen host/domain, HTTPS, persistent volumes, production password, and secrets.
      Build/deploy only as a separately authorized release; the supplied container has not been built here.
- [x] Save the owner-provided Resend key in private, Git-ignored local server configuration (25 October).
- [x] Configure `bookings@asa-express.com` as the sender and the owner-approved Gmail inbox for
      ongoing dispatch notifications in private local/production configuration and persisted admin settings.
      The public URL is `https://www.asa-express.com`, currently serving the older Vercel landing page.
- [x] Send one clearly labelled live test email to the authorized inbox. Resend accepted it with HTTP 200
      and its dashboard confirmed Delivered on 25 October. The sending-only key cannot retrieve delivery
      status through the API; dashboard evidence and the private diagnostic record confirm this test.
- [x] Test app-generated email locally using four isolated bookings and the authorized Gmail inbox:
      14 messages accepted by Resend and individually confirmed Delivered in its dashboard. Covered
      receipts, rounded negotiation acceptance, rejection, rescheduling, customer cancellation,
      pickup/arrival/completion, pickup-time expiry, and secure history. The admin UI retried a
      simulated pre-send HTTP 422 failure successfully; duplicate submissions and repeated retries
      sent no extra messages. Verified history access in Chrome, one-use and expired-link rejection,
      and logout. Operating records/settings were unchanged; no live callbacks were simulated.
- [ ] Configure and verify the signed Resend webhook once the updated public API is deployed.
- [ ] When ready, add Google OAuth credentials/token key, connect the intended account, choose the
      calendar and verify real event creation/rescheduling/cancellation and recovery. This setup is
      postponed by the owner; placeholders remain blank and booking decisions continue normally.
- [ ] Repeat a booking/history smoke check using deployed HTTPS links and verify real provider callbacks.
      Local app-generated delivery and the failed-send retry above are complete; public URLs and
      callbacks remain unverified. Delivered means recipient-server acceptance, not inbox placement.
- [ ] If WhatsApp is wanted at launch, choose/connect its provider adapter, verify opt-in/template
      behavior and real delivery, then enable it. Otherwise leave it disabled. Handset-delivery
      callbacks require that provider's contract and are not currently implemented.
- [ ] Put verified backups in protected off-host storage, assign backup/failure-monitoring ownership,
      and rehearse restoration on the actual host. Local snapshots alone do not cover host loss.
- [ ] Check the actual deployed mobile/desktop journey and direct private links; confirm rate-limit
      proxy configuration, health monitoring, disk/log retention, and rollback readiness.
- [ ] Obtain the owner's release acceptance and go live.

## Explicitly deferred by the owner

- Google Calendar account configuration and live verification: implementation is complete; the owner
  requested placeholders so the account and calendar can be added later.
- Ride duration estimates and travel buffers: no 60-minute default. Warnings flag possible conflicts
  on the same Lagos pickup date and let the admin decide. Revisit duration policy later.

Payments, live GPS, driver accounts/assignment, ratings, and map autocomplete are outside this MVP.
Chrome checks and automated test updates/runs were authorized in this conversation. No builds or
subagents are authorized under the current working rules.
