# Asa Ride operating and release guide

The approved application scope is implemented. Google Calendar linking has blank configuration for
the owner's later account setup; duration estimates remain deferred. Resend sender/key and the
approved dispatch inbox are configured privately. One live diagnostic
email and all 14 app-generated emails from four isolated local bookings were confirmed Delivered by
Resend on 25 October 2026. Local receipt/decision/schedule/cancellation/trip/expiry/history checks and
a controlled failed-send/admin retry passed. Delivery means recipient-server acceptance; inbox
placement was not inspected. The deployed HTTPS journey, signed webhook updates, and production
deployment remain unverified. Build commands below are instructions
for a future release: no build was run during implementation.

## Configure email when ready

Keep all values on the server, never in a `VITE_` variable, browser storage, or Git.

1. In Resend, verify a sending domain and create a sending API key. Choose the sender address and
   optional reply-to address. See [Send Email](https://resend.com/docs/api-reference/emails/send-email).
2. Set `ASA_BOLT_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `ASA_BOLT_EMAIL_FROM`
   (for example, `Asa Ride <rides@your-domain>`). Optionally set `ASA_BOLT_EMAIL_REPLY_TO`.
3. Set `ASA_BOLT_PUBLIC_APP_URL` to the exact HTTPS origin, without a path, query, or fragment.
4. Add `https://YOUR_DOMAIN/api/webhooks/resend` in Resend. Subscribe to `email.sent`,
   `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`,
   and `email.suppressed`. Put its signing secret in `RESEND_WEBHOOK_SECRET` and restart the app.
   The server checks the raw-body signature and a five-minute timestamp tolerance. Keep the server
   clock synchronized. See [Resend events](https://resend.com/docs/webhooks/event-types).
5. Open Admin → Notifications → Email. Add the dispatch recipients and review event switches/text.
   The environment recipient list seeds settings only once; edit existing settings in the portal.
6. With addresses you control, check a receipt, acceptance/rejection, reschedule, cancellation,
   trip-stage updates, and a My requests link. Confirm that messages arrive and links open the
   correct request. Verify a signed delivery event updates the log. Use provider-supported test
   destinations for bounce/failure checks. Configuration alone does not prove delivery.

Provider acceptance means Resend accepted the API call. Delivered means the recipient mail server
accepted it; neither means a person read it. Bounce, complaint, delay, and provider failure remain
visible separately. The app does not collect open/click tracking.

A failed or uncertain message never rolls back a ride. Open its saved message and attempts before
retrying. Retries retain the recipient, content, sender snapshot, and stable delivery ID. An uncertain
Resend result can be retried only with the same configuration within 23 hours of record creation,
conservatively inside [Resend's 24-hour key retention](https://resend.com/docs/dashboard/emails/idempotency-keys).
Do not bypass a blocked retry: inspect the provider record. Old status/pickup updates, delivered
messages, bounces, complaints, and disabled destinations cannot be replayed. History links require a
fresh customer request; their verification tokens are not retained in admin delivery records.

Without credentials, requests and decisions still save and email failures are visible. My requests
cannot be unlocked until its email can be sent. Development-only previews can use a private
`ASA_BOLT_EMAIL_OUTBOX_DIR`; they send no real email and are disabled in production.

## Google Calendar — configure later

Google Calendar is the chosen provider. The integration is implemented, but its configuration is
deliberately blank in the private local/production environment files and examples. No account or
calendar has been chosen or accessed. Until setup is complete, **Admin → Calendar** shows Not
configured and accepted rides queue as Awaiting calendar setup. Bookings and email continue normally.

When ready:

1. In the intended Google Cloud project, enable Google Calendar API and configure its OAuth consent
   settings for the intended account. Create a **Web application** OAuth client. Register the exact
   callback shown in Admin → Calendar: `ASA_BOLT_PUBLIC_APP_URL` plus
   `/api/calendar/google/callback`. For the normal local app this is
   `http://localhost:5173/api/calendar/google/callback`; after deployment it is
   `https://www.asa-express.com/api/calendar/google/callback` if that remains the configured origin.
2. Store `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` only on the server.
   Generate `ASA_BOLT_CALENDAR_TOKEN_KEY` with `openssl rand -hex 32`, save its 64 hex characters
   privately and retain that key with recovery secrets. Restart the app after changing configuration.
   Never use a `VITE_` variable for these values or paste tokens into source control.
3. Sign in to the app admin, open Calendar, choose Connect Google Calendar and approve access.
   The app requests `calendar.events` and `calendar.calendarlist.readonly`, plus offline access.
   An external OAuth application in Google's Testing mode has seven-day refresh-token expiry;
   configure the appropriate Google publishing/verification settings for ongoing use.
4. Choose **Check connection & load calendars**, select the intended writable calendar and save.
   A dedicated Asa Ride calendar can be created in Google Calendar beforehand. The app does not
   automatically create calendars, assume an account email, invite customers or read event lists.
5. With controlled test rides, verify creation at the Lagos pickup time, rescheduling of the same
   event, cancellation and a failed-update retry. Confirm the external event IDs remain unchanged.
   This real-account check has not been performed; current evidence uses an isolated Google simulation.

The app manages private pickup markers, not duration estimates. Google's required compatibility
end value is pickup plus one minute, with `endTimeUnspecified=true` and transparent free/busy status.
No ride duration or overlap rule is inferred from that value. The event includes the request reference,
route, agreed fare and the admin portal address; it excludes customer email and private status tokens.
External calendar edits do not change bookings in the app. Do not delete app-managed events directly
in Google; deleted events may need restoration there before the same ID can be updated again.

The five-second worker processes at most five pending updates per cycle. Failed updates do not
silently retry forever: review them under Calendar and retry the latest revision. Retries reconcile
the stored event ID, even if a previous creation response was lost. An interrupted send becomes
visible as a failed update after its lease expires. A newer saved ride change supersedes older work.
Google connection checks report access failures separately from saved booking decisions.

Once an update targets a calendar, keep that account and calendar for subsequent changes. Moving
existing events to another calendar requires a deliberate migration beyond this initial integration.
Disconnect removes local credentials and attempts to revoke Google access; it leaves existing
events intact. If Google revocation cannot be confirmed, the admin screen says so. An in-flight
request can still finish after disconnect. Later booking changes wait for reconnection.

Backups contain encrypted Google tokens, so preserve the original token key separately. Losing or
changing it requires restoration of that key or reconnecting the same Google account. After database
recovery, review saved ride/calendar state before resuming sync; an older backup can predate external
updates. OAuth state is short-lived and tied to admin sessions, so restart any interrupted sign-in.

Official references: [OAuth web-server setup](https://developers.google.com/identity/protocols/oauth2/web-server),
[token expiration](https://developers.google.com/identity/protocols/oauth2#expiration),
[Calendar scopes](https://developers.google.com/workspace/calendar/api/auth),
[event IDs and creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
and [unspecified event end times](https://developers.google.com/workspace/calendar/api/v3/reference/events).

## Optional WhatsApp

WhatsApp starts disabled and has no selected live provider. Email remains the main channel.
Customers may explicitly opt in with a Nigerian WhatsApp number on a request. A legacy phone number
never implies consent. Customers can stop future WhatsApp updates in their private request details
using the request email; the original opt-in and opt-out times remain recorded. Already-sent messages
cannot be recalled. An in-flight send may already have reached the adapter before opt-out.

To enable the implemented adapter interface later:

- Supply `ASA_BOLT_WHATSAPP_WEBHOOK_URL` (HTTPS, no embedded credentials) and
  `ASA_BOLT_WHATSAPP_WEBHOOK_TOKEN` on the server.
- The adapter must translate the supplied text into the chosen provider's approved booking
  notifications and links, respecting its template and opt-in requirements.
- Admin → Notifications → Optional WhatsApp has its own recipients, master switch, eight event
  controls, text, revision checks, delivery log, and manual retries. Add only admin numbers whose
  owners agreed to updates. Keep the switch off until real delivery has been checked.
- No handset-delivery callbacks are implemented for this unspecified adapter. A successful adapter
  response is labelled provider accepted, with handset delivery unverified.

The adapter receives a JSON envelope:

```json
{
  "event": "request.updated",
  "notificationEvent": "request.accepted",
  "brand": "Asa Ride",
  "channel": "whatsapp",
  "deliveryId": "stable UUID",
  "idempotencyKey": "same UUID",
  "payload": { "to": "+234...", "subject": "Request update", "text": "Saved booking update" }
}
```

`event` is `request.received`, `request.updated`, or `request.rescheduled`. It carries a stable
`Idempotency-Key` header and bearer authentication. Only 2xx is acceptance; network errors, 5xx,
408, and 409 are uncertain. Configure `ASA_BOLT_WHATSAPP_WEBHOOK_IDEMPOTENT=true` only after proving
atomic deduplication across concurrent retries and restarts. Set
`ASA_BOLT_WHATSAPP_WEBHOOK_IDEMPOTENCY_MINUTES` to a retention window the adapter actually supports
(default 60). Uncertain retries are blocked without that guarantee. Definite failures can be retried
once configuration is corrected; disabled, stale, or opted-out messages cannot be resent.

The legacy generic email adapter remains available when Resend is not selected. Its equivalent
variables are `ASA_BOLT_EMAIL_WEBHOOK_URL`, `_TOKEN`, `_IDEMPOTENT`, and
`ASA_BOLT_EMAIL_WEBHOOK_IDEMPOTENCY_MINUTES`. Its envelope adds `channel: "email"` and permits
`event: "history.link"`. Native Resend takes precedence when selected or when its API key is supplied.

## Scheduling and dispatch

In **Pricing & routes**, create an area with its name and optional ₦/km rate, then assign it in the
route editor. Each direction has its own assignment. A fixed price effective on pickup day takes
priority; otherwise the area rate applies, with the default as fallback when the area rate is blank.
Use “No area · use default rate” to remove an assignment. Clearing an area rate keeps assignments
and makes those routes use the default. With no applicable rate or fixed price, the route is
unavailable. Previews and customer quotes round up to ₦50. Rate/area edits affect new quotes;
existing booking prices and their saved area names/rates do not change. Research labels do not
automatically assign pricing areas.

1. Review pending requests, route, pickup, saved quote, and any offer. Acceptance agrees to the
   rounded offer or, without an offer, the saved quote. Rejection requires a reason.
2. Review possible conflicts before acceptance or an accepted-ride reschedule. Warnings compare
   other accepted/in-progress rides on the same Lagos pickup date. They assume no duration or buffer;
   the admin can proceed after review. A changed conflict list requires a fresh review.
3. Use Schedule to maintain weekly windows and closures. Closing a date flags affected accepted
   rides; contact/reschedule/cancel them explicitly. It does not silently move existing rides.
4. Rescheduling requires a reason and an open future pickup. Prices stay saved. Cancellation also
   requires a reason. Continue accepted rides through pickup, arrival, and completion.
5. Unanswered pending requests become rejected at pickup time with
   **“Not accepted before pickup time.”** The worker checks every five seconds while running and
   catches up on startup. API requests also process due requests before actions. Accepted/in-progress
   rides are unaffected. The system audit and email/WhatsApp snapshots commit with rejection.

A refresh loads current request and notification data. Sessions expire after eight hours; restarting
or rotating the server password invalidates admin sessions. Keep the owner password private. There
are no separate staff accounts, password recovery, payments, driver assignment, or live tracking.

## Prepare a production release

Use one app process and one persistent SQLite volume. Do not run multiple replicas or place the live
SQLite database on a shared/network filesystem. Backups and the message queue are local to this
installation. The supplied Compose setup provides a private app port, Caddy HTTPS, persistent data
and backups, health checks, restart policies, and bounded container logs.

1. Prepare a host with Docker/Compose and point the chosen domain's DNS at it. Permit public
   ports 80/443. Keep the app's 8787 port private.
2. Copy `.env.production.example` to `.env.production` and protect it with `chmod 600`.
   Set the domain, exact HTTPS URL, a unique random owner password of at least 32 characters,
   and real email settings when ready. For a random password, `openssl rand -hex 24` is suitable.
   Weak/example/default passwords prevent production startup. Never paste secrets into Git.
3. Review container image versions and record the release Git revision and image digest. Keep the
   previous image available for rollback. The current container configuration has not been built here.
4. For a future authorized release, build/start with
   `docker compose --env-file .env.production up -d --build`. This command runs a frontend build.
   **It was not run during this implementation.** Check `docker compose --env-file .env.production ps`
   and `/api/health` over HTTPS. The container also requires a readable frontend `index.html`.
5. Review/publish only served research routes. Set approved default/fixed prices, locations,
   operating hours, closures, and recipients. Research rates are suggestions, not approved prices.
6. Check direct navigation to `/admin`, `/my-requests`, and a private status URL. The API serves the
   compiled SPA on the same origin when `ASA_BOLT_STATIC_DIR` is set. Private pages/API responses are
   not cached; fingerprinted static assets can be cached. Do not put databases/outboxes in `dist`.
7. Check real delivery and the full mobile customer/admin journey, then obtain launch acceptance.

For hosting without Compose, use Node 24+, install runtime dependencies, prepare the frontend in a
separately authorized release, set `NODE_ENV=production`, `ASA_BOLT_STATIC_DIR`, persistent database
and backup paths, and run `npm start` behind HTTPS. `ASA_BOLT_HOST` defaults to loopback. The Compose
container sets it to `0.0.0.0` only on its private network. `tsx` is a runtime dependency.

`ASA_BOLT_TRUST_PROXY=1` trusts exactly one proxy's rightmost forwarded client address. Enable it only
when the app port cannot be accessed directly and that proxy appends/overwrites forwarded addresses.
Otherwise leave it `0`; forwarded headers are ignored. Same-origin API hosting is required for the
HttpOnly, SameSite=Strict history cookie.

## Back up and restore

The app makes a verified SQLite snapshot at startup and every six hours when `ASA_BOLT_BACKUP_DIR`
is set. `ASA_BOLT_BACKUP_HOURS` changes the interval (minimum one hour). It retains 28 named snapshots
and never prunes unrelated files. Only snapshots that pass integrity/foreign-key checks are published
under the final backup name; interrupted `.partial-*` files are ignored. Restrictive file permissions
protect saved rides and private links. This is a local recovery copy, not protection against loss of
its host: copy verified snapshots to protected off-host storage with an agreed retention policy.

Manual backup and restore commands for a Node installation:

```bash
npm run db:backup -- /absolute/live.sqlite /absolute/private-backups
npm run db:restore -- /absolute/backup.sqlite /absolute/new-restored.sqlite
```

Live WAL changes are included through SQLite's backup API. Do not copy only the `.sqlite` file while
an app is writing. Restore creates a new verified database and refuses to overwrite any existing file.

For recovery:

1. Stop the app process and keep the current database files intact. Choose a known verified backup.
2. Run `db:restore` to a new database path on the persistent volume. Wait for successful verification.
3. Point `ASA_BOLT_DATABASE_PATH` at the restored file (or adjust the container's environment override),
   restart one app process, then verify health, admin access, recent rides/prices, and notification logs.
4. Inspect uncertain/queued messages before retrying. A restored database can predate deliveries sent
   after its snapshot. Expired idempotency windows are deliberately blocked; reconcile against Resend
   before sending anything that might already have arrived. Explain any lost post-backup ride changes
   to the operating admin.

For the Compose installation, the equivalent manual backup is:
`docker compose --env-file .env.production exec app npm run db:backup -- /app/data/asa-bolt.sqlite /app/backups`.
For a stopped-app restore, use a one-off container with the same volumes and a new filename, then
change the `ASA_BOLT_DATABASE_PATH` environment override in `compose.yaml` before restarting.
Keep the previous file for rollback; do not replace a live database.

## Monitor and roll back

- Monitor HTTPS `/api/health` and container restarts; it checks application/database availability,
  not email delivery. Review Notifications for failed/uncertain/bounced messages, pending dispatch
  requests, and expiry notices. Watch `[operations]` log entries for backup/worker failures and disk use.
- API logs contain request IDs, method, route category, HTTP status, and elapsed time. They omit
  private URL paths/tokens, email addresses, and bodies. Keep proxy access logs disabled or redact
  private URLs before enabling them. Never log provider keys or raw webhook/email bodies.
- Compose rotates each container's logs at 10 MiB with five files. Choose an operational retention
  policy for externally collected logs and backups, and assign someone to review failures.
- Before each upgrade, take a verified backup and record the previous application image. On failure,
  stop the new process and restore the previous image with its compatible database. New schema changes
  are additive, but verify compatibility for the actual release. If database restore is needed, use a
  new file and the recovery procedure above. Restoring an old snapshot loses later changes and needs
  message reconciliation. Do not delete the failed installation's evidence.

## Verification record

See `plan.md` for the manual checks and automated results. Desktop/mobile checks used fake addresses,
a separate temporary database, an intercepted Resend transport, and a fake WhatsApp adapter. The
backup/restore procedure, unconfigured-provider behavior, login limits, private routing, and security
headers were also checked locally. No real messages, domain setup, Docker deployment, or production
frontend build were performed. Compose configuration parsing passed with the example environment; this does not verify a container build. These are launch checks after the owner's configuration, not claimed
completed delivery.
