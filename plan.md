# Asa Ride — implementation plan

## Current direction

[HANDOVER.md](HANDOVER.md) is the source of truth for the product. Asa Ride is a mobile-first
ride service with a customer portal and a private admin portal. Customers use email without signup,
review a price, and either accept it or make one negotiation offer. Every new request stays pending
until the admin decides or the approved pickup-time expiry applies. Access to the portal is free; rides have an agreed fare.

The approved application scope is implemented and locally verified, including native Resend,
expiry, optional WhatsApp consent/settings, and release/backup tooling. Resend is configured and
local app-generated email delivery has been verified. Area pricing was authorized and implemented
on 27 October 2026. Google Calendar linking was subsequently authorized and implemented with blank
configuration for later account setup. Duration estimates remain deferred. Launch operations
remain in TODO.md and RUNBOOK.md. The step-by-step notes below retain each earlier checkpoint;
the final completion pass records the current implementation and authorized test results.

## Step 1 — connect the existing screens

Implemented:

- Shared Asa Ride branding, header navigation, and footer.
- Customer booking at `/`, admin portal at `/admin`, and the `/owner` compatibility address.
- Private ride details at `/status/:token`, including direct links from booking summaries.
- A standalone location request at `/request-location`.
- Browser back/forward navigation, page titles, keyboard focus on navigation, and a missing-page screen.
- Mobile navigation and admin section controls that wrap instead of requiring horizontal scrolling.
- Admin code loads when its portal is opened; admin API endpoints retain their session checks.
- Intro text stays above decorative graphics, with heading sizes that fit the booking panel.

Verification status: formatting checks on the changed files and repository-wide lint passed. Manual
HTTP checks confirmed that the customer, admin, and status addresses load and that unauthenticated
admin API access returns 401. With the owner's permission, Chrome checks on 20 October 2026 confirmed:

- Customer booking and location-request navigation, page titles, route focus, and browser back/forward.
- Admin sign-in, all five existing admin sections, the `/owner` address, and sign-out followed by reload.
- A dummy booking's summary-to-status link and reloading the same private status address.
- Useful messages for an invalid status link and an unknown page.
- No horizontal page overflow on the checked 320px and 375px customer/status screens, 375px admin
  sections, and 1440px desktop booking screen. Screenshots exposed a decorative overlap; the corrected
  layout was checked again on mobile and desktop.

The browser session used a separate temporary SQLite database and console-only notifications. No
builds, automated tests, or regression suites were run. The previous coming-soon landing-page test
still needs permission to replace. Do not treat the whole product as complete at this checkpoint.

## Step 2 — email requests and private history

Implemented:

- Email-first requests without required name, phone, signup, or password; pending approval replaces
  automatic confirmation. Basic admin acceptance/rejection was brought forward from step 4 so new
  requests can be managed immediately. Rejection requires a reason and stays separate from cancellation.
- Additive SQLite updates preserve old phone-only bookings and their existing prices/statuses.
- Request a ride, Request details, and My requests screens, with email-based cancellation for new
  requests and existing phone-based cancellation for legacy records.
- One-use 15-minute email links with hashed tokens, an explicit verification action, and 30-minute
  HttpOnly sessions. The verified email is the only history selector. Sessions can be revoked.
- SQLite-backed limits on link requests, verification attempts, and new booking emails. Private
  responses are not cached; origin checks and strict cookies protect history actions.
- Receipts and decision emails through a server-configured webhook or a private development outbox.
  Live inbox delivery is not yet connected or verified. Missing delivery configuration fails visibly.
- Server-side quote revalidation with renewed agreement after price changes, duplicate-submit
  protection, immutable fare snapshots, and Africa/Lagos pickup-time handling.
- Same-site `/api` proxying in development and automatic server `.env` loading.

Manual verification on 20 October 2026 used dummy `.test` emails, the existing temporary review
database, and a private local outbox. No real messages were sent. Verified outcomes:

- An email-only submission stayed pending; a duplicate API submission returned the same request.
- Chrome showed a changed fare and reset agreement; re-agreement saved the new quote. Later fare
  edits preserved existing request amounts. Admin approval of a closed day returned 409.
- Admin acceptance and rejection appeared in request history and private details, with actor,
  timestamp, rejection reason, quoted fare, and agreed fare only after acceptance. Email previews
  contained receipts and decision text. Email cancellation worked for a pending request.
- History returned newest requests first, including rejected and cancelled requests. It excluded
  another email's request and the old phone-only booking, which remained visible in the admin.
- An email without verification returned 401. Reused, forged, and expired links, expired sessions,
  and a revoked session returned 401. An untrusted-origin exchange returned 403. A fourth link
  request for the same address returned 429. A verified email with no rides returned an empty list.
- Cookie headers contained HttpOnly, SameSite=Strict, the restricted API path, and a 30-minute age.
  Reloading history kept the valid session. URL fragments were removed before exchange.
- The request/history/details/admin screens were checked at a 375px phone viewport without
  horizontal overflow. History also fit a 320px viewport. Closing the private session in Chrome hid
  the list immediately and returned the email-link form.

Formatting and lint are the permitted automated checks. Existing automated tests still describe the
old phone-only/automatic-confirmation flow and have not been edited or run. Builds and regression
suites remain unrun. Production still needs the configured HTTPS email adapter and same-site API routing.

## Step 3 — route research and pricing

Owner decision: **Use default and fixed prices only for now.** Area rates and route-to-pricing-area
assignments are deferred. Research area labels are retained only as source metadata.

Implemented:

- A reproducible, standard-library workbook extraction with its source SHA-256, plus a transactional,
  one-time SQLite import of 27 locations and 351 pairs as 702 independent directions. The workbook is
  unchanged; cached workbook fares are not imported as approved prices. Fresh installs start with
  all research routes hidden and no default rate. Existing location IDs, fares, bookings, and served
  routes are retained. Restarting leaves admin changes intact.
- Source map links, pair keys, workbook rows, collection timestamps, and original distances alongside
  editable directional distances and correction notes. Research locations can be edited or hidden.
- Admin default rate controls, searchable/paginated route review, draft creation, publication,
  hiding, and dated fixed-price creation/editing/deactivation. Server previews show the applied
  method, inputs, unrounded amount, and final fare before saving. Each direction is independent.
- Fixed-price precedence over default distance pricing; exact decimal arithmetic with upward ₦50
  rounding for new calculated and fixed quotes. Missing pricing rejects the quote. Negotiation will
  reuse this rule when implemented in step 4.
- Published connections determine customer choices. Hidden routes or endpoint locations cannot be
  quoted or requested. New requests save full pricing inputs and the final amount; later pricing
  changes preserve existing records and stale quotes require renewed customer agreement.

Manual checks on 20 October 2026 used a separate temporary SQLite database, fake `.test` emails, and
local email previews. Verified:

- Fresh import: 27 locations, 702 draft routes, no fixed prices or default rate. Repeated import did
  not create duplicates. Migration matched existing locations and preserved six earlier bookings.
- All handover rounding examples, including exact ₦850, plus the full precision reference rate.
- Default changes, fixed precedence, default fallback after deactivation, dated future prices,
  fixed-only routes without distance, and useful errors for missing prices or invalid zero values.
- One direction changed to 8.12 km while the reverse and original research distance remained 9.8 km.
  Publishing, hiding, and hiding an endpoint controlled customer access as expected.
- A new distance-priced request retained ₦850 and its 8.12 km × ₦100 snapshot after pricing edits.
  A fixed-priced request retained ₦1,000 and its raw ₦999 input. A stale submission returned 409 and
  the new quote; older phone-only and email bookings kept their previous amounts.
- In Chrome, the admin saved a default rate, corrected/published a research direction, previewed and
  saved a fixed price, and the customer submitted a pending request at that rounded price. Pricing
  controls fitted 320px and 1440px; customer screens fitted 320px/375px. Imported location
  editing also worked at 375px, with publication and research metadata retained. These checked
  views had no horizontal page overflow.

Formatting and lint are the permitted checks. Builds, automated tests, and regression suites remain
unrun under the owner's working rules. Production rates and served routes still require admin review.

## Step 4 — negotiation and admin decisions

Implemented for the owner's negotiation request:

- Accept price or Negotiate price, one positive offer in naira, an optional 240-character note, a
  server-calculated upward ₦50 preview, and explicit agreement before submission. Input and mode
  changes reset agreement; stale preview responses cannot replace a newer offer.
- Additive database fields keep original quote/pricing inputs, canonical raw offer, rounded offer,
  note, and agreed amount separate. No offer editing, counter-offers, or second decision is exposed.
  Idempotent retries return the original saved offer. Rejected requests allow a fresh request.
- Admin acceptance explicitly displays and agrees the rounded offer (or original quote when no
  offer exists). Rejection requires a reason and leaves no agreed fare. The status, agreed amount,
  and actor/timestamp audit event commit in one transaction. Repeated decisions are idempotent;
  opposite decisions after acceptance/rejection return a conflict. Pending requests stay pending.
- Shared price presentation in summaries, private details, admin cards, and verified email history.
  Receipt/decision content contains quoted, proposed, and agreed amounts as applicable. Provider
  credentials and live delivery setup are unchanged.
- Accepted offers keep their agreed price through pickup, arrival, completion, and cancellation.
  Older phone-only and email records retain their previous fares and status history. Existing
  future-time, operating-hours, closed-date, duplicate-submit, and quote-revalidation checks apply.

Manual verification on 21 October 2026 used a copy of the earlier temporary review database, fake
`.test` recipients, and a private local email outbox. No real messages were sent. Checks confirmed:

- All four handover rounding examples, rejection of zero/negative/invalid or over-precision input,
  and server rejection of a tampered rounded amount or offer supplied on the accept-price path.
- Original quote ₦1,000, entered offer ₦812, proposed fare ₦850, and agreed fare ₦850 after acceptance.
  No agreed fare while pending or rejected. Acceptance without negotiation keeps the original price.
- Repeated submission keeps one request and its original offer; repeated acceptance keeps one
  decision event. Unauthenticated decisions fail, and accepted/rejected decisions cannot be reversed.
- Pricing edits leave stored quotes, offers, and agreed fares unchanged. A stale original quote
  while negotiating returns the new quote for renewed agreement. Downstream trip states keep ₦850.
- Chrome at 375px exercised offer preview/submission and admin acceptance/rejection with a reason.
  Verified email history showed only that email's accepted and rejected requests, newest first,
  with the correct separate amounts and no agreed fare for rejection. Details provided a new-request
  link. The checked history/details screens also fitted 320px without horizontal overflow.
- Closing a pickup date blocked offer acceptance; reopening allowed it. Cancellation after acceptance
  preserved the quote, offer, and agreed fare.
- The copied ten pre-existing bookings survived migration, including their existing agreed fares.
  Local receipt/decision previews contain the separate amounts, offer notes, private link, and reasons.

Admin date/status filters, email/reference/legacy-phone search, expanded details, and advisory
conflict warnings are now implemented; verification is recorded below. The expiry rule still needs
the owner's decision at that checkpoint. The final completion pass records the later approved and implemented cutoff.

Formatting and lint are the permitted checks. No builds, automated tests, or regression suites were
run. Production email delivery remains unconnected and requires separate provider verification.

## Step 5 — operations and integrations

Implemented admin/scheduling scope:

- Repaired the interrupted admin refactor and restored all five sections, sign-in, location actions,
  server-backed sign-out, refresh, and useful session/network errors.
- Combined case-insensitive email/reference/legacy-phone search, status filters, inclusive Lagos
  pickup-date filters, invalid-range feedback, result counts, empty states, and 20-item pages.
- Expanded request details with contact, pickup note, saved calculation, notification state, status
  audit history, and schedule changes. Schedule management opens the correct request page/details.
- Upcoming accepted/in-progress rides, date selection and past-pickup controls; weekly-window editing,
  disabling/enabling, split shifts, date closures/reopening, and warnings about affected saved rides.
- Rescheduling pending/accepted rides with a reason, open future pickup, schedule revision protection,
  atomic audit events, idempotent repeat saves, preserved prices/status, and customer/admin updates.
- **Owner decision on 24 October:** possible conflicts and admin judgement now; duration estimates later.
  Other accepted/in-progress rides on the same Lagos pickup date trigger a possible-conflict warning;
  exact-time matches are identified. No 60-minute default, finish time, or buffer is assumed. This
  conservative rule may warn about feasible same-day rides and cannot detect cross-date overlaps.
- Server availability/conflict checks run inside the write transaction. Explicit acknowledgement can
  proceed; new/changed active reservations invalidate an earlier review. Pending/rejected/cancelled/
  completed rides do not reserve capacity.

Manual verification on 24 October 2026 used a fresh temporary SQLite database, fake `.test`
recipients, and private local email previews. Chrome's connection was unavailable, so current UI
checks used the available in-app browser. No real messages were sent. Verified:

- Admin sign-in/session expiry, all five sections, search/combined status/date filters, inclusive
  same-day filtering, invalid ranges, empty matches, clear filters, 29-request pagination (then 31 including past fixtures), legacy
  phone search, and Schedule → Manage ride opening page 2 with the selected details expanded.
- Possible-conflict review before acceptance and accepted-ride rescheduling; explicit reviewed actions
  succeed. Manual HTTP checks confirmed changed reservations require a fresh token, exact-time
  warnings, separate-date acceptance, excluded inactive statuses, protected endpoints, and all trip stages.
- Window editing/disabling/enabling, separate same-day shifts, overlapping/invalid window rejection,
  exclusive closing boundary, closing/reopening, and saved accepted rides remaining unchanged.
- Pending/accepted rescheduling, previous/new pickup and reason in audit history, unchanged ₦850 quote,
  ₦799 raw offer, ₦800 proposed/agreed fare, stale revision rejection, no duplicate event/email on retry,
  invalid calendar dates and past/closed/outside-hours rejection, and blocked cancelled-ride edits. An older browser edit received a conflict, kept the newer pickup,
  and offered Load current schedule.
- Customer split-shift selection switches the selected window and its time bounds. Private details
  and verified-email history show the changed pickup and reason. Local reschedule email previews
  contain previous/new Lagos times, reason, private link, and separate quote/proposed/agreed amounts.
- Migrating a separate original-schema phone booking preserved its status, contact, private access,
  and unrounded ₦812.34 legacy fare. A second migration preserved the same record.
- Request/details and schedule screens fit checked 320px/375px viewports; customer selection/history
  fit 375px. Desktop request/schedule inspection at 1440px found no horizontal overflow. A stretched
  status badge was corrected and rechecked.

Formatting/lint are the permitted automated checks. No builds, typecheck builds, automated tests, or
regression suites were run. Live inbox delivery and calendar integration are not verified.

Implemented notification-management scope on 24 October 2026:

- New Notifications section with persistent admin recipients, ride-email master switch, separate
  customer/admin event switches, and editable plain-text additions for eight ride events. Required
  ride details and saved prices remain in messages. Settings use revision checks and survive restarts.
- A durable per-recipient ledger, original message snapshots, attempt history, search, status filters,
  pagination, and connection information distinguishing configuration from actual provider acceptance.
- Email snapshots commit with each request, decision, or reschedule before delivery starts. Queued
  records survive interruption. Failed sends do not undo saved rides or prices.
- Manual retries preserve the original recipient, message and delivery ID, with atomic claims,
  expected-attempt checks, and protection against repeated success, concurrent sends, disabled
  destinations/events, and older status/pickup snapshots.
- Unconfirmed sends remain uncertain. Retry needs the same adapter with verified deduplication
  support, within its configured key-retention window (60 minutes by default). Interrupted leases
  recover as uncertain; rejected retries do not erase that uncertainty. Expired windows block resends.
- History emails send independently of ride switches; verification tokens/bodies stay out of the
  ledger and admin responses. Private links cannot be replayed through admin retries.
- Latest customer email status is shown independently of other notification channels. Provider
  acceptance is described accurately; it is not presented as confirmed inbox delivery.

Manual verification used an isolated temporary SQLite database, fake `.test` recipients, a local
HTTPS adapter with a locally trusted certificate, and private preview files. No real emails were sent.
The adapter simulated rejection, acceptance, delayed responses, lost responses, and server errors.
Checked:

- Recipient normalization/deduplication, customer/admin sharing one copy, empty/disabled event behavior,
  custom text with immutable prices, saved preferences after restart, invalid settings, and stale edits.
- Failed email retry, concurrent retries yielding one send and one conflict, repeat success with no
  extra send, original message/key preservation, and no extra booking or decision events.
- Lost-response recovery with a stable key and unchanged provider delivery count; interrupted lease
  recovery; queued records available after interruption; uncertain results remaining uncertain after
  a rejected retry; and expiry of the safe retry window preventing a resend.
- Old decision/pickup emails blocked after later changes; unconfigured email still saving the ride;
  local preview retries using one file; and customer-only delivery state updating after retry.
- Failed history delivery rejecting access, successful history verification/read, ride-email switches
  leaving private links enabled, and history metadata/details containing no verification tokens.
- Admin-only settings/details/retries, invalid filters, original-schema legacy status and unrounded
  fare preservation, and repeated additive migration. No historical delivery rows were invented.
- In-app browser checks for settings, recipient/event/message edits, stale revision feedback, original
  message/attempt display, failed-email retry, case-insensitive search, status filters, empty results,
  and pagination across more than 40 delivery records. Mobile overflow in the new settings grid was
  found and fixed. Final settings, delivery records, and expanded message/attempt views fit 320px
  and 375px without horizontal overflow; the desktop view also fit 1440px. The customer details
  screen accurately reports acceptance for sending, without claiming inbox delivery.

Formatting and lint are the permitted checks. No builds, typecheck builds, automated tests, or
regression suites were run. The real provider, sender credentials, inbox delivery, and bounce/delivery
callbacks have not been connected or verified. The temporary adapter verifies local behavior only.

Operations/integrations outstanding at the earlier notification checkpoint (superseded by the completion pass):

- Connect and verify real email delivery with an adapter that honors the documented retry contract.
- Add WhatsApp consent/preferences, message controls, and delivery records/retries if enabled.
- Agree one calendar provider with the owner, then link accepted rides to its events.
- Preserve external event IDs so rescheduling, cancellation, and retries update the same event.
- Keep an accepted request saved if a calendar operation fails and expose a retry action.
- Keep provider credentials on the server.

## Step 6 — release readiness

- Manually demonstrate every completion outcome in HANDOVER.md at a phone-sized viewport.
- Configure real service data and private admin access, persistent database storage, and backups.
- Configure frontend hosting to serve index.html for client routes and proxy `/api` to the Node service.
- Reuse the existing React/Vite, Node API, and SQLite structure.

## Owner decisions resolved on 24 October 2026

1. Reject unanswered requests at pickup time with “Not accepted before pickup time.”
2. Leave calendar linking for later; no provider integration in the current completion scope.
3. Use Resend; the owner will configure its account later.
4. Keep default/fixed pricing and possible same-day warnings; area rates and durations stay deferred.

## Working rules

Ask before using Chrome tools. Complete manual checks before requesting permission to write tests.
Get explicit permission before regression tests. Do not run builds; use only permitted formatting and
lint checks. Do not use subagents.

## Completion pass — 24 October 2026 (implemented)

Owner decisions: use Resend, with account configuration deferred; leave calendar linking for later;
automatically reject unanswered requests at pickup time with “Not accepted before pickup time.”
Default/fixed pricing and advisory same-day scheduling warnings remain the approved scope.

Completed native Resend transport, signed provider events and delivery states, durable expiry
notifications, optional WhatsApp consent/settings, production access/rate limits, backups and restore,
deployment configuration, operating documentation, and final local manual verification. Live email
verification requires the owner's later sender/key configuration. Calendar work is explicitly deferred.
After the manual checks, the owner explicitly approved updating/running automated tests. No builds,
typecheck builds, deployment, or subagents were used.

### Implementation details

- Native Resend requests use server-only credentials, a fixed HTTPS endpoint, frozen message/sender
  snapshots, delivery tags, stable idempotency keys, and paced starts. Lost responses remain uncertain;
  retry coalescing, atomic leases, same-configuration checks, and a conservative 23-hour window prevent
  unsafe replay. Provider acceptance is distinct from mail-server delivery and human receipt.
- Raw-body Svix signatures and five-minute timestamps protect callbacks. Persisted event hashes reject
  reused identifiers with different content. Unknown message IDs can link when the send result arrives.
  Delivered/bounced/complained states survive later lower-priority events and send-response races.
  Provider bodies and private history tokens are absent from admin delivery records.
- Due pending requests reject with the approved reason, system actor, and immutable prices. The status
  event and email/WhatsApp snapshots commit atomically. A five-second worker catches up at startup;
  API actions also expire due requests. Accepted/in-progress rides never expire under this rule.
- WhatsApp has isolated settings, recipients, events, messages, attempts, retries, and a required-token
  HTTPS adapter. It starts disabled. New request opt-in and later opt-out timestamps are stored;
  existing phones never imply consent. Current consent is rechecked before queued sends/retries.
  Customers stop future WhatsApp updates through private details plus the request email. No selected
  live adapter or handset-delivery callbacks are claimed; email is the primary channel.
- Strong non-default production access, origin checks, private cache/security headers, explicit
  one-proxy trust, SQLite-backed general/login/location/private-action limits, sanitized request logs,
  database health checks, graceful shutdown, and optional same-origin compiled SPA serving are present.
- Backup commands use SQLite's online backup API, verify integrity/foreign keys, apply private file
  permissions, and publish only verified snapshots atomically. Automatic backups keep 28 snapshots
  at a default six-hour interval. Restore never overwrites a file. Compose includes private app
  networking, persistent data/backups, Caddy HTTPS, health checks, restart policies and bounded logs.
  The Dockerfile and Compose release path have not been built or deployed.
- RUNBOOK.md covers account setup, notification semantics, adapter contracts, dispatch/expiry,
  deployment, off-host recovery, monitoring, release acceptance, and rollback. TODO.md now separates
  implemented features, remaining launch operations, and explicit deferrals.

### Manual verification

Used an isolated SQLite database and fake `.test` recipients. Native Resend fetches were intercepted
inside the injected transport; no real provider was called. A separate fake WhatsApp adapter simulated
failure and acceptance. Production-mode checks used a different temporary database and a minimal
static HTML routing fixture; they did not compile or verify a production frontend bundle.

Checked:

- Customer request with optional WhatsApp consent, quote, one ₦812 offer previewing/saving as ₦850,
  pending receipt, admin acceptance at ₦850, original quote retained, and rescheduling with a reason.
- Resend acceptance vs signed mail-server delivery; bad/stale signatures rejected with 401; duplicate
  callback harmless; out-of-order sent/delayed callbacks never downgrade delivery; bounce stops replay.
- Lost-response retry reused the same body/key/provider ID and did not increase unique provider sends;
  repeating success created no extra send, request, or audit event.
- Unanswered request remained pending before pickup, then rejected with exactly the approved reason,
  one system audit event, no agreed fare, and delivered-to-adapter rejection notices. Verified email
  history showed the rejection/reason; email entry alone showed no rides. Private-session logout worked.
- WhatsApp default disabled, independent saved settings, failed-delivery inspection/retry, successful
  retry with original text/key, explicit opt-out, and rescheduling after opt-out without a new customer
  WhatsApp delivery. Settings/deliveries persisted after restart; admin sessions required fresh sign-in.
- Customer private details/history fit 375px. Admin notification settings fit 320px with no horizontal
  overflow; desktop navigation/request/notification flows also worked. Earlier phases cover broader
  schedule/conflict/pricing layouts; the current pass did not claim a new live-provider check.
- Manual backup included active WAL data; restore matched rides/routes/delivery state with integrity
  check `ok` and mode 0600. A second restore to the same target refused with EEXIST. Automatic startup
  backup published a verified snapshot in the isolated production-mode fixture.
- Production startup rejected weak access and HTTP public URLs. SPA fallback/private paths, health,
  asset serving, hidden-file denial and security headers worked with the static routing fixture.
  The login-limit boundary returned 401 then 429 despite different untrusted forwarded addresses.
  Request logs contained route categories and IDs without raw private paths or email contacts.

### Authorized automated verification

The owner replied “Yes—update and run tests” after the manual checks. Updated the obsolete landing,
phone-only and auto-confirmation tests, and added focused regression coverage for pricing, lifecycle,
scheduling, expiry, consent, Resend sends/callbacks, private history, API access/limits and backups.
The browser test environment stubs its unsupported scroll API; real browser checks cover layout.

`npm test`: **50 passed across seven files**. `npm run lint` and formatting checks passed.
No builds or typecheck builds ran. The final suite includes backup publication/path selection, sender validation and the jsdom scroll stub; configuration parsing passed separately from an actual container build. A final worker check also verifies interrupted leases become uncertain without needing an admin visit. Real Resend/WhatsApp delivery, a container build, production hosting, off-host backups,
and release acceptance remain launch work. Deferred calendar/area/duration scope is unchanged.

Mobile verification screenshot (fake review data only): `outputs/implementation-review/history-mobile.png`.

## Resend account configuration — 25 October 2026

The owner supplied a Resend API key and requested configuration and completion. Saved the key only
in `.env` (Git-ignored, mode 0600); no key value is recorded in source, documentation, or command output.
Created a unique private local admin password, cleared placeholder dispatch recipients, and enabled
local verified backups. The key is loaded by the existing server scripts.

A live read-only Resend domain-list request returned HTTP 401 with `restricted_api_key`. This key
cannot discover verified domains or create/manage webhooks. No real email has been sent: a sender
address and controlled recipient have not been supplied. The sender address, dispatch/test inbox and
public app URL/hosting have been requested. Live sending, signed callback configuration and release
verification remain pending those inputs. The standing no-build rule remains in force.

Local startup and API checks: database health 200, private admin login/notification access 200, key
loaded, sender/webhook absent, no placeholder admin recipients. Fresh research routes remain drafts
and no rate is approved; these were not silently published or priced. No build or regression run was
needed for this private configuration-only change.

## DevTools account and public-site check — 25 October 2026

With the owner's explicit request, Chrome DevTools MCP confirmed:

- The active Yellow May Resend account has `asa-express.com` verified for sending.
- The supplied key's visible prefix matches the `asa-express` key, with Sending access. No key was copied or exposed in the findings.
- `https://asa-express.com` redirects to `https://www.asa-express.com/`, which responds HTTP 200 from Vercel and currently shows the older opening-soon/WhatsApp landing page.
- The updated local app starts successfully; location, route and availability requests return HTTP 200. It correctly shows no published routes in the fresh local database. Browser warnings were observed, without an application stack; no source defect was inferred from them.

Saved the discovered canonical origin/domain and the already-authorized key in private, Git-ignored `.env.production` (0600). Its sender, dispatch inbox and webhook secret remain unset. Local development retains its localhost origin so private-history origin checks continue to work. No email was sent, no API key/account settings were changed, and no build or deployment ran. The verified email domain does not by itself deploy the updated app.

## Live Resend sender and dispatch configuration — 25 October 2026

The owner selected `bookings@asa-express.com`, authorized a live test to a specific Gmail inbox, then
confirmed the same inbox should receive ongoing admin notifications. Configured the branded sender
and dispatch address in `.env` and `.env.production`, preserving owner-only mode 0600 and Git ignores.
Updated the running app's persisted notification settings through the authenticated API, retaining
its existing event controls. Re-read connection/settings: native Resend enabled, ride emails enabled,
new-request admin updates enabled, and exactly the approved dispatch recipient configured.

Sent exactly one clearly labelled diagnostic email through the native Resend HTTPS endpoint using
a saved stable idempotency key. The diagnostic creates no ride and contains no private access token.
Resend returned HTTP 200 and a message ID. Chrome DevTools MCP confirmed the matching sender,
recipient, subject, Sent event and Delivered event in the Yellow May account. This establishes provider
reported delivery to the recipient mail server; human reading or inbox placement is not claimed.
A status-retrieval API request returned `restricted_api_key`, consistent with sending-only access;
no broader credential was requested. The request/result evidence stays under Git-ignored
`private-outbox/provider-check/` with private permissions; no credential or recipient is copied here.

The running application reports Resend mode with no signed webhook secret yet. Public deployment
and signed callback setup remain pending; the public website still serves the previous landing page.
The one diagnostic validates live sender/key/recipient delivery, while complete deployed booking-email
journeys and callback/retry acceptance remain release checks. No build, deployment, extra diagnostic
messages, or regression run was performed for this configuration-only change.

## Local app-generated live email verification — 25 October 2026

The owner authorized local app-generated email tests to the approved Gmail inbox and deferred
webhook checks until deployment. Used a separate private SQLite database and a temporary local
React/API instance; operating bookings, pricing, hours, recipients, and credentials were unchanged.
All test booking messages were labelled “LOCAL EMAIL TEST — no real ride or dispatch required.”

Four isolated bookings generated 14 real Resend messages: four pending receipts, two acceptances,
one reschedule, pickup/arrival/completion updates, one manual rejection, one customer cancellation,
one actual pickup-time expiry rejection, and one private history link. Resend returned HTTP 200
for all 14 distinct message IDs. Individually matched each ID, recipient, subject and Delivered state
against the authenticated Yellow May dashboard. Delivery means recipient-server acceptance; Gmail
inbox/spam placement and human reading were not inspected. Customer/admin notifications were
correctly combined because both roles used the same inbox.

The first receipt encountered one deliberately simulated HTTP 422 in the isolated transport,
before any Resend request. Chrome showed Failed and a pending saved ride. Used the real admin UI
confirmation/retry, which sent successfully through Resend with the original body and stable key.
The attempt log recorded failed/system then accepted/admin. Duplicate booking submission and
repeated retry created neither another booking nor another provider message. This is a controlled
failure/recovery check, not evidence that Resend actually rejected the initial attempt.

Checked the negotiated ₦812 → ₦850 offer, acceptance fare, saved schedule-change and cancellation/
rejection reasons, and completed private status. Let the five-second worker expire a real future
pickup cutoff; its notification contained “Not accepted before pickup time.”

Opened the actual generated history link in Chrome and saw all four requests for the verified
address, including both rejected requests and the cancelled one. The delivered email body’s token
hash matched the tested link. Verified the 15-minute expiry timestamp, removal of the URL fragment,
HttpOnly cookie, one-use rejection, logout followed by HTTP 401, and an independently seeded expired
link returning 401. Admin history-message records contained no verification body/token.

Private, Git-ignored evidence is under `private-outbox/local-email-review-2026-10-25/` with restricted
permissions. The app correctly retains Provider accepted locally because no signed callbacks were
injected or configured; dashboard Delivered evidence is recorded separately. Signed callback and
deployed HTTPS link checks remain pending. No application code, build, deployment, or new regression
suite was needed for this verification.

## Area pricing — 27 October 2026

The owner authorized the handover's one-area-per-route rule with a default rate fallback,
superseding the earlier default/fixed-only decision. Calendar linking and duration estimates remain
deferred. No existing research labels were automatically converted into pricing assignments or rates.

Implemented named admin pricing areas with optional precise decimal ₦/km rates, single-area route
assignment/clearing, editable rates/names, and server previews before saving. Fixed prices effective
on the pickup date take priority; otherwise the assigned area rate applies, falling back to the
default when no area rate is set. Clearing an area rate retains its assignments. Missing all usable
prices makes a route unavailable. Existing routes stay unassigned after migration and retain their
previous default/fixed behavior until the admin makes an assignment.

Added an additive SQLite area table and nullable route foreign key. Quote snapshots include area
ID/name, applied rate and rate source, so later rate changes, renaming or reassignment cannot rewrite
past quoted, proposed or agreed prices. A changed fare at submission still requires renewed consent.
Admin details show the saved rate source, while catalogue search includes area names. Research
provenance and reverse directions remain independent.

Manual API checks used an isolated database and no real email provider. Verified area precedence,
blank-rate/default fallback, unavailable fares, fixed precedence, changed-quote consent, preserved
bookings, unknown/invalid assignments, unauthorized writes, duplicate names, independent directions,
and omitted assignment compatibility. Migrated a pre-area database containing all 702 routes and
a saved booking twice, checking retention and SQLite integrity. In Chrome, created an area,
assigned it to a route, previewed ₦1,650 at 8.12 km × ₦200/km, then cleared its rate on mobile and
verified the customer quote returned to ₦850 at the default ₦100/km. No horizontal overflow at
375 px. The customer form also displayed the expected area-priced ₦1,250 quote and consent text
at 375 px. All demonstration data was isolated from operating records.

Added eight service/migration tests, one authenticated HTTP pricing workflow and two admin UI tests.
`npm test`: **61 passed across nine files**. Lint, formatting (excluding Git-ignored private runtime
artifacts), and `git diff --check` passed. No builds/typecheck builds, deployment, real email sends,
calendar changes, or subagents were used.

## Google Calendar with deferred account setup — 27 October 2026

The owner selected Google Calendar and requested placeholders so the account/calendar can be added
later. This supersedes the earlier calendar implementation deferral; real account configuration
and verification remain postponed. No Google credentials or calendar identity were invented.

Implemented **Admin → Calendar** with explicit Not configured/Not connected/Choose a calendar/Linked
states, connection checks, writable-calendar selection, searchable update records, failed-update
retry and disconnect confirmation. Added blank Google client ID/client secret/token-encryption-key
fields to server environment examples and private Git-ignored local/production environment files.
Secrets remain server-side. Setup instructions and official provider references are in RUNBOOK.md.

Acceptance, accepted-ride rescheduling and cancellation enqueue calendar snapshots atomically with
the ride change. Google requests run separately in the five-second worker. Each ride receives a
stable Google-compatible event ID before its first attempt. Retries reconcile that same ID after
lost responses; wrong-owner events are not overwritten. Superseded in-flight snapshots cannot mark
newer changes synced. Interrupted work becomes visibly failed and retryable after its lease expires.
Upcoming accepted rides that predate linking are discovered at startup; pending/rejected requests
do not create events. Calendar failures never undo a saved acceptance or reschedule.

Events are private Lagos-time pickup markers with no attendee invitations, customer email or private
status tokens. Google's required end value is one minute after pickup, with endTimeUnspecified and
transparent free/busy status; no ride-duration estimate or overlap policy is introduced. Rescheduling
and cancellation update the original event. The app remains the place to manage rides.

Google OAuth uses a single-use ten-minute state tied to an active admin session, PKCE and offline
access. Refresh/access credentials and proof-key verifiers are encrypted with AES-256-GCM in SQLite.
Tokens and provider error bodies never enter admin responses. Settings revisions protect reconnect,
calendar selection and disconnect. Existing events keep their account/calendar binding; moving them
requires an explicit migration. Disconnect clears local tokens and attempts revocation without
deleting events. Saved changes resume on reconnecting the same account/calendar.

Manual verification used an isolated SQLite database, local UI/API and fake Google transport. Checked
the blank configuration screen and disabled connect button, acceptance awaiting setup with zero
provider calls, authenticated routes, valid/invalid/replayed OAuth state, encrypted credentials, token
refresh, calendar selection, marker creation, failed reschedule and real admin-UI retry, cancellation,
lost-create-response reconciliation without another insert, destination locking, disconnect and
updates waiting for reconnection. Chrome checked the Calendar screen at desktop and 375 px with no
horizontal overflow. Private evidence is under `private-outbox/calendar-review-2026-10-27/`.

Added thirteen calendar service tests, two API tests and three admin component tests, including
concurrent rescheduling during event creation, negotiated fares, revoked access, key changes,
restart/lease recovery and reconnect. **79 tests passed across eleven files.** Lint, formatting and
diff checks passed. No real Google account access, email sends, builds/typecheck builds, deployment
or subagents were used. Live Google authorization and create/reschedule/cancel checks await the
owner's later configuration.
