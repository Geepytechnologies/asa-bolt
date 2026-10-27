# Asa Ride

Asa Ride is an independent ride-booking service for Eastern Nigeria. [HANDOVER.md](HANDOVER.md)
defines the current product direction: email-based ride requests without signup, admin approval,
negotiated fares, secure request history, configurable pricing, optional notifications, and Google Calendar linking.

The customer and admin screens are connected. Customers now request rides with email, without a name,
phone number, account, or password. New requests stay pending until an admin accepts or rejects them.
Private email links unlock request history. Research routes, area and default distance pricing, fixed prices,
upward ₦50 rounding, admin previews, and single-offer negotiation are implemented. Area pricing was
authorized on 27 October 2026: each route can use one admin-assigned area, with the default rate as
fallback when its area has no rate. Admin email settings, delivery records, and safe manual retries
are implemented. Native Resend delivery, signed delivery events, pickup-time expiry, optional WhatsApp consent/settings, and release/backup tooling are implemented. The sender/key and dispatch inbox are configured, and live app-generated emails were confirmed Delivered by Resend. Google Calendar integration is implemented with blank server configuration for later account connection. Deployed workflow, live Google access and signed email webhook checks remain pending.

## Portal navigation

- `/`: customer booking form and booking summary.
- `/admin`: admin sign-in, request management, scheduling, pricing/locations, location requests, and notifications.
- `/owner`: compatibility address for the same admin portal.
- `/status/:token`: private booking details, opened from a booking's status link.
- `/my-requests`: request an email link, verify it, and view that email's request history.
- `/request-location`: request a location that is not currently offered.

Navigation supports direct links and browser back/forward. Frontend production hosting must serve
`index.html` for these client routes, including private status links. Set `ASA_BOLT_STATIC_DIR` to the compiled frontend directory to serve the SPA and API together. Development uses Vite. Admin API access still requires a valid session token.

## Local setup

Requirements: Node.js 24+ (Node's built-in `node:sqlite` is used) and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

The customer app runs at `http://localhost:5173`; the API runs at `http://127.0.0.1:8787`.
On first start, `./data/asa-bolt.sqlite` receives the research locations and draft routes, with no
default rate or fixed prices selected. Default Mon–Sat operating hours still require admin review.
Database updates add fields without replacing existing bookings or their prices.
For a fresh local dataset, choose a new `ASA_BOLT_DATABASE_PATH` instead of deleting existing records.
The server scripts load `.env` when it exists; exported environment variables take precedence.

## Research routes and pricing

Open **Admin portal → Pricing & routes** to configure the default ₦/km rate, create/edit pricing
areas and their rates, assign an area to a direction, search the route
catalogue, correct distances, preview fares, publish or hide a direction, and add/edit/deactivate
fixed prices with effective dates. The Locations section can edit, publish, or hide individual
locations. Publishing a route also publishes both endpoint locations. Hiding a location blocks its
routes; hiding one direction leaves other directions unchanged. The customer form lists published
connections only, and the server checks publication again before quoting or saving a request.

The supplied workbook contains 27 locations and 351 pairs. Each pair starts as two independent
directions (702 research routes). The application imports the committed extraction in
`server/data/abia-research.json` once, transactionally, and records its workbook SHA-256. Repeated
startup preserves admin edits and does not duplicate routes. Matching existing location names reuse
their IDs; existing fixed-fare connections retain their publication state. Older dummy records are
preserved for admin review rather than removed automatically.

The extraction retains location IDs, categories, research areas, map links, original distances,
route-pair keys, source rows, source labels, and collection timestamps. Research area labels remain
provenance; billing areas and their route assignments are configured separately by the admin.
The admin sees the original distance alongside the editable value. The original
workbook and its cached nearest-naira fares are not changed or used as approved app prices.
To regenerate the extraction from the supplied workbook (Python standard library only):

```bash
python3 scripts/import-route-research.py
```

Pricing uses the latest active fixed price effective on the pickup date; ties use the most recently
created rule. Otherwise, multiply distance by the assigned area's rate, falling back to the default
rate if the area has no rate or the route has no assigned area. Decimal strings and integer
arithmetic preserve rate precision, and only the final fare rounds upward to ₦50. For example,
8.12 km × ₦100 = ₦812 → ₦850; fixed ₦999 → ₦1,000; ₦850 stays ₦850; ₦1,001 → ₦1,050.
Rates and distances must be positive; fixed prices accept at most two decimal places. Missing
pricing produces an unavailable message, never a guessed or zero fare. Area rates can be cleared
without removing their route assignments. Existing routes retain their default/fixed pricing until
explicitly assigned an area; no research rates or area assignments are inferred automatically.

Admin previews use the same server calculation as customer quotes and accept unsaved values before
saving. New requests store the area ID/name, rate source, distance, applied rate or fixed price/rule, unrounded amount, rounding
step, and final quoted fare. Existing records keep their stored amount without being re-rounded.
The server rechecks the current quote at submission and returns a changed price for renewed consent.

Pricing API: public `GET /api/routes` and `GET /api/fares/preview`; authenticated
`GET /api/owner/pricing`, `POST /api/owner/pricing/preview`, `PATCH /api/owner/pricing/settings`,
`PATCH /api/owner/pricing/areas/:id` (`new` to create; `{ name, ratePerKm }`, null rate uses the default),
`PATCH /api/owner/routes/:id` (`pricingAreaId` assigns one area, null clears it, omission preserves it),
and the existing location/fare-rule endpoints. Area changes affect new quotes; saved quotes and
negotiated/agreed fares keep their original area and pricing snapshots.

## Google Calendar

Open **Admin → Calendar**. Configuration fields are deliberately blank until the owner is ready:
`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and `ASA_BOLT_CALENDAR_TOKEN_KEY`
(a stable 32-byte encryption key written as 64 hexadecimal characters). Blank or invalid configuration
shows **Not configured**; accepted rides save normally and calendar updates wait without provider calls.

After configuring a Google OAuth web client, connect an account in the admin portal and load its
writable calendars. Choose a destination and save. The callback address is the exact public app
origin plus `/api/calendar/google/callback`. No account email or calendar ID is hard-coded; both are
selected later. See [RUNBOOK.md](RUNBOOK.md) for Google setup, permissions and recovery.

Accepted rides become private Lagos-time pickup markers. They do not reserve a ride duration:
Google's `endTimeUnspecified` flag is set, its required compatibility end value is one minute after
pickup, and the event is transparent to free/busy calculations. The app remains authoritative;
external calendar edits never reschedule or cancel app bookings. There are no attendee invitations,
customer email addresses, or private booking access tokens in event payloads.

Acceptance/rescheduling/cancellation enqueue updates atomically with the saved ride. A five-second
worker syncs them separately. Stable Google-compatible event IDs are saved before the first send;
retries read and update that same event, including after a lost creation response. Failed and
interrupted updates remain visible and retryable. Pending/rejected requests do not create events;
a ride cancelled before its first sync does not create a cancelled placeholder in Google.
Upcoming accepted rides that predate linking are queued for reconciliation at startup.

Offline Google tokens and OAuth proof-key verifiers are encrypted with AES-256-GCM in SQLite.
OAuth state expires after ten minutes, is single-use, and requires the originating admin session to
remain valid. Tokens/client secrets never appear in admin responses or frontend environment variables.
Once rides have been sent, keep the same account and calendar so updates reach their original events.
Disconnecting clears local tokens and attempts Google revocation; existing events stay in place.

Authenticated APIs: `GET /api/owner/calendar`, `POST /api/owner/calendar/connect`,
`GET /api/owner/calendar/calendars`, `PATCH /api/owner/calendar/settings`,
`POST /api/owner/calendar/disconnect`, and `POST /api/owner/calendar/updates/:bookingId/retry`.
Settings/disconnect/retry operations include `expectedRevision`. The OAuth callback is public but
requires a valid state bound to a live admin session. Real Google connection remains unverified;
all current calendar checks use an isolated provider simulation.

## Email requests and private history

New bookings require `email` and `quotedAmountKobo` alongside the existing route, pickup time, and
idempotency key. Name and phone are optional legacy fields. The server validates the quote and Lagos
pickup time, checks availability, saves a pending request, and records the customer and timestamp.
Admin acceptance checks availability again; rejection requires a reason and is distinct from cancellation.
Existing phone-only bookings retain their status, fare, private links, and admin visibility. They are
never attached to an email merely because someone supplies a matching phone number.

`POST /api/history/link` sends the same generic response whether the email has requests or not.
The email contains `/my-requests#token=...`; the browser removes the fragment before verification.
Opening the link requires an explicit button click. Tokens contain 256 random bits, are stored only as
SHA-256 hashes, expire after 15 minutes, and can be exchanged once. The resulting 30-minute session
uses an HttpOnly, SameSite=Strict cookie restricted to `/api/history`, with Secure enabled for HTTPS.
History reads use only the verified session email and return all its requests, newest first. Closing
the private session revokes it on the server. Link requests, verification attempts, and new bookings
are rate limited in SQLite; rate limits use the direct peer IP by default. A single trusted reverse proxy can be explicitly configured; see `RUNBOOK.md`.

The browser defaults to `/api`; Vite proxies it to the local API. In production, route `/api` to the
Node service on the same site. Set `ASA_BOLT_PUBLIC_APP_URL` to the frontend's exact HTTPS origin:
this controls email URLs, allowed CORS requests, and origin checks. Cross-site frontend/API hosting
is incompatible with the strict history cookie. Never derive private email links from request headers.

### One price offer per request

After reviewing a quote, choose **Accept price** or **Negotiate price**. A negotiation includes one
positive offer in naira (up to two decimal places) and an optional 240-character note. The server
previews the offer with the same upward ₦50 rule before the customer confirms it. For example,
entering ₦812 sends a proposed fare of ₦850. Any positive offer is allowed; no additional minimum or
maximum relative to the quote has been imposed.

The request remains pending. Admin acceptance uses the saved rounded offer as the agreed fare;
accepting a request without an offer uses the original quote. Rejection requires a reason and leaves
no agreed fare. The original quote, raw offer, rounded offer, note, and agreed amount remain separate.
Later pricing changes preserve all of them. Decision and fare updates are saved atomically with the
status audit event. Repeated decisions do not create another event or notification, and an acceptance
or rejection cannot be reversed into the other decision. Existing cancellation and trip stages remain
available after acceptance and retain the agreed fare.

There is no offer editing or counter-offer endpoint. A retry with the same idempotency key returns
the original request and offer. After rejection, the customer can make a new request with a new key.
The server still revalidates the original quote for negotiations; a changed quote requires renewed
agreement even if the proposed fare stays the same.

`POST /api/offers/preview` accepts `{ amountNaira: "812" }` and returns
`{ amountNaira: "812", roundedAmountKobo: 85000 }`. Booking creation adds `priceChoice` (`accept` or
`negotiate`). Negotiation sends `proposedAmountNaira`, the previewed `proposedAmountKobo`, and optional
`negotiationNote`. The server recomputes the rounded amount and rejects a mismatched preview. Existing
clients that omit `priceChoice` retain the accept-price path. Client-supplied agreed amounts never
control admin acceptance.

Booking responses include optional `offer: { amountNaira, roundedAmountKobo, note }` and
`agreedAmountKobo`. `fare` continues to hold the immutable original quote. Request summaries, private
details, verified email history, admin controls, and email content show the appropriate separate
amounts. Optional booking webhook consumers should use `agreedAmountKobo` after acceptance rather
than treating the original `fare.amountKobo` as the negotiated total.

The owner approved automatic rejection at pickup time. A five-second worker and API actions reject due pending requests with “Not accepted before pickup time.” Startup catches up after downtime. Rejection, the system audit event, and notification snapshots save atomically. Accepted rides are unaffected; silence never confirms a request.

## Admin requests and scheduling

The Requests section combines status and inclusive pickup-date filters with case-insensitive
email/reference/legacy-phone search, counts, and pagination. Dates use Africa/Lagos. Expanded
request details show contact information, pickup notes, saved pricing inputs, delivery status,
and status/schedule audit histories. Schedule → Manage ride opens the matching queue page and details.

The Schedule section lists accepted and in-progress rides, filters by pickup date, and can include
past pickups. Admins can add/edit/disable weekly pickup windows and close/reopen dates with a reason.
Separate shifts on one day are supported; active operating windows cannot overlap, and their closing
time is excluded. Changes to availability flag affected accepted rides without moving or cancelling them.

**Current owner decision:** show possible conflicts and let the admin decide. Other accepted or
in-progress rides on the same Lagos pickup date trigger an advisory warning, with exact pickup-time
matches distinguished. Pending, rejected, cancelled, and completed rides do not reserve capacity.
Without durations this deliberately broad warning can include rides that can be served together;
it cannot determine finish times or identify cross-date overlaps. No duration or buffer is assumed.

Acceptance and rescheduling an accepted ride recheck availability and conflicts inside the write
transaction. Conflicts require explicit review, then the admin can proceed. A changed set of active
rides requires a fresh review. Rescheduling is available for pending/accepted rides only and requires
a reason and a valid future pickup inside open hours. Original quote, offer, agreed fare, and status
are preserved. A schedule revision rejects stale edits; an identical repeat creates no extra audit
entry or email. Private details/history show the updated pickup and reason. Cancellation continues
to require a reason and sends the existing customer update.

Authenticated API additions: `GET /api/owner/bookings/:id/conflicts`,
`POST /api/owner/bookings/:id/schedule-preview` with `pickupAt`, and
`PATCH /api/owner/bookings/:id/schedule` with `pickupAt`, `expectedRevision`, and `reason`.
A conflicting acceptance/reschedule returns HTTP 409 with `review: { conflicts, token }`;
after admin acknowledgement, repeat the action with `conflictToken: review.token`.
Pickup timestamps must include their timezone. Duration inputs are not currently supported.

## Notification settings and delivery records

Open **Admin portal → Notifications**. Configure up to ten admin email recipients, a ride-email
master switch, independent customer/admin switches for eight ride events, and additional plain-text
message text for each event. Events cover receipts, acceptance, rejection, cancellation, pickup
rescheduling, pickup, arrival, and completion. The route, Lagos pickup, saved prices, decision/reason,
and private details link are always retained. Duplicate recipients receive one email per event,
including an admin who is also the customer. An empty admin list sends no admin copies.

Settings are saved in SQLite with revision protection. Environment recipients seed the first settings
record only; later restarts preserve admin edits. New settings apply to future events. Disabling an
event or removing an admin recipient also blocks retries to that destination. Existing saved message
content and recipients cannot be edited by the retry endpoint. Ride emails disabled by settings are
recorded as skipped; private history links remain independent and send only to the requesting email.

The delivery log supports recipient/reference search, status filtering, pagination, original message
inspection, and timestamped attempts identifying automatic sends and admin retries. It distinguishes
queued/sending, provider accepted, local preview, failed, uncertain, disabled, superseded, and signed Resend delivery/delay/bounce/complaint/provider-failure updates. Connection information
reflects server configuration and actual recorded attempts; it is not an inbox or provider health test.
An HTTP success means the configured adapter accepted the message, not that it reached an inbox.

Ride changes and all recipient email snapshots commit together before any delivery attempt. If the process stops before sending, the background worker resumes queued current updates after restart; they can also be sent manually. Failed sends never undo the saved
request, decision, schedule, or fare. A retry atomically claims one existing delivery with its expected
attempt count. Concurrent/repeated clicks cannot create another successful send. An interrupted send
lease becomes uncertain after 30 seconds; it is never automatically treated as a definite failure.
Older status or pickup snapshots cannot be retried after a ride changes.

Network failures, HTTP 5xx, and ambiguous adapter replies are uncertain. Retrying those requires the
same HTTPS adapter, verified idempotency support, and an unexpired deduplication window. The adapter
must atomically deduplicate and retain delivery keys for at least that configured window. Rejected
retries do not erase an earlier uncertain result. After the window expires, check provider records;
the app blocks a resend because it cannot establish that another email would be safe.

Private history-link records contain delivery metadata only: verification tokens and email bodies
are not stored in this log or returned to admins. Failed/expired/used links require the customer to
request a fresh link; they cannot be replayed through the retry endpoint. Older aggregate notification
statuses are retained, but detailed delivery records begin when this feature is installed. Booking
responses add `customerEmailStatus` for the latest customer email independently of other channels.

Authenticated API:

- `GET /api/owner/notifications?q=&status=&page=0`: settings, connection information, counts, and 20 records.
- `PATCH /api/owner/notifications/settings`: complete settings with the last saved `revision`.
- `GET /api/owner/notifications/deliveries/:id`: saved message and attempt history.
- `POST /api/owner/notifications/deliveries/:id/retry`: `{ expectedAttempts: 1 }`; recipient/content stay fixed.

### Resend and optional WhatsApp

Resend is the selected email provider. Set `ASA_BOLT_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`,
`ASA_BOLT_EMAIL_FROM`, optional `ASA_BOLT_EMAIL_REPLY_TO`, and `RESEND_WEBHOOK_SECRET` on the server.
The signed callback endpoint is `POST /api/webhooks/resend`. Missing configuration stays visible;
ride requests still save. `bookings@asa-express.com` and the approved dispatch inbox are configured
privately. On 25 October 2026, Resend confirmed delivery of a diagnostic and all 14 app-generated
messages from four isolated local test bookings. Real email checks covered receipts, decisions,
schedule changes, cancellation, trip stages, expiry, and private history. Chrome checks verified
history access and an admin retry after a simulated pre-send failure, without duplicate sends.
Signed callbacks and deployed HTTPS link verification remain pending. Provider delivery means
recipient-server acceptance; inbox placement and reading are not claimed.
Stable delivery keys, sender/content snapshots, signature verification, duplicate event handling, and
out-of-order delivery states are implemented. Uncertain Resend retries use a conservative 23-hour window.

WhatsApp is optional and disabled by default. Customers explicitly opt in with `whatsappUpdates`
and `whatsappNumber`; legacy phone numbers do not imply consent. Opt-in/out times are preserved.
Customers can stop updates in private request details using their request email. Admin controls,
message snapshots, attempts, searches, and safe retries are separate from email, under
`/api/owner/whatsapp-notifications` with the same settings/deliveries API structure. Its legacy
`emailEnabled` settings field serves as that channel's master switch. The configured HTTPS adapter
requires a server-side token; real WhatsApp setup/delivery is pending if the owner enables it.
Native handset-delivery callbacks await a provider choice; adapter acceptance is labelled accordingly.

See [RUNBOOK.md](RUNBOOK.md) for Resend setup, WhatsApp adapter/idempotency contracts, safe retries,
admin operating steps, release configuration, backups, recovery, monitoring, and rollback. Private
history-link verification bodies remain outside the delivery ledger, including during retries.

Permitted checks:

```bash
npm run format:check
npm run lint
```

Follow the working rules in `HANDOVER.md`: ask before Chrome tools, complete manual checks before
requesting permission to write tests, obtain explicit permission for regression tests, and do not run
builds or use subagents. The owner authorized browser checks and, after manual verification,
authorized updating/running the automated tests on 24 October 2026. See `plan.md` for actual results.

## Release readiness

The repository includes a Node 24 Dockerfile, same-origin SPA/API hosting, a Caddy/Compose HTTPS
configuration, persistent database/backup volumes, health checks, strong production password checks,
SQLite-backed API/login limits, restricted proxy trust, security headers, redacted request logging,
and verified backup/restore commands. See [.env.production.example](.env.production.example) and
[RUNBOOK.md](RUNBOOK.md). Deployment artifacts have not been built or deployed.

Before launch, configure hosting/domain/secrets and Resend, review and publish service data/prices/hours,
verify real delivery, establish off-host backup/monitoring ownership, and perform release acceptance.
Use a single app process with local persistent SQLite storage. Builds remain excluded from this work.

Ride duration estimates remain deferred. Google account/calendar configuration is postponed at the
owner's request while its integration is implemented. No payments, live GPS,
driver accounts, automated driver assignment, ratings, or map autocomplete are in this MVP. Google Maps
links and landmark notes are supported without a paid map integration. The current release checklist
is [TODO.md](TODO.md).
