# Asa Bolt

Asa Bolt is a local Umuahia ride-booking MVP. It is an independent service, not a Bolt integration.
Customers book with a phone number only; the owner manages schedules, locations, fares, bookings, and
location requests from a password-protected desk.

## Local setup

Requirements: Node.js 24+ (Node's built-in `node:sqlite` is used) and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

The customer app runs at `http://localhost:5173`; the API runs at `http://127.0.0.1:8787`.
The seeded dataset is clearly labelled as dummy data and is created in `./data/asa-bolt.sqlite` on
first start. Remove that local database when you want a fresh seed.

Useful checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

## Configuration and production gaps

`ASA_BOLT_OWNER_PASSWORD` is the one local owner credential. Change it before any shared deployment.
`ASA_BOLT_DATABASE_PATH` controls the SQLite file. `ASA_BOLT_OWNER_EMAIL` and
`ASA_BOLT_OWNER_WHATSAPP` are reserved for notification configuration.

Local notifications use a safe console adapter. Optional webhook adapters are available only when
`ASA_BOLT_EMAIL_WEBHOOK_URL` / `ASA_BOLT_WHATSAPP_WEBHOOK_URL` and their token variables are supplied;
the project does not contain or request real email/WhatsApp credentials. Production setup still needs:

- a managed HTTPS host, reverse proxy, and secure secrets manager;
- a backed-up, single-writer database or migration to a managed SQL store;
- real email and WhatsApp provider adapters with verified sender/business details;
- rate limiting, monitoring, log retention, HTTPS-only cookies/tokens, and an operational owner account;
- replacement of the dummy Umuahia locations, schedules, fares, owner contacts, and notification details.

No payments, live GPS, driver accounts, automated driver assignment, ratings, or map autocomplete are in
this MVP. Google Maps links and landmark notes are supported without a paid map integration.
