# Asa Bolt — MVP Build Plan

## Product direction

Asa Bolt is an independent, Umuahia-focused ride-booking and dispatch service.
It is a Bolt competitor, not an integration with Bolt.

The first release should help a customer request a ride from a published origin
to a published destination and help the owner manage and communicate
the booking. It should work well on a phone and avoid recurring platform costs
where practical.

## MVP outcome

By the end of the MVP:

1. A customer can request a ride without creating an account.
2. The customer sees the current price before confirming the request.
3. The owner receives the booking and can manage it from a private dashboard.
4. The owner can manage operating hours, locations, and fare changes.
5. The customer can follow booking status and receive useful updates.
6. A customer can request an unavailable location and later learn whether it was
   added.

## Actors

- Customer: books a ride, checks status, and requests new locations.
- Owner/dispatcher: manages availability, prices, bookings, and notifications.
- Rider/driver: initially receives instructions from the owner; a separate driver
  interface is out of scope for the first release.

## Proposed product surfaces

### Customer surface

- Landing and booking page.
- Date and time selection.
- Published pickup and destination selection.
- Fare preview.
- Customer details: name and phone only.
- Booking confirmation with reference and private status link.
- Booking status page.
- New-location request form.

### Owner surface

- Owner sign-in.
- Today/upcoming booking queue.
- Booking details and status actions.
- Schedule and closed-date management.
- Published location management.
- Fare management with effective dates and history.
- New-location request review.
- Notification delivery state and retry visibility.

## Booking lifecycle

`requested` → `confirmed` → `picked_up` → `arrived` → `completed`

Bookings within an available schedule are automatically confirmed. Any active
booking may move to `cancelled` by either party, but a reason is required. Every
status change must be recorded with its timestamp and actor. A customer-facing
status page must explain the current state in plain language.

## Core business rules

- Prices are configured per origin/destination route.
- A booking stores a fare snapshot; later price changes do not alter existing
  bookings.
- Bookings use Africa/Lagos for display and store an unambiguous timestamp.
- A phone number is used to prefill returning customers, not as public access to
  their booking history.
- Public booking details require an opaque booking token or booking reference
  plus an additional customer check.
- Booking creation and status changes are idempotent against accidental retries.
- The owner can close a date or schedule window before accepting new bookings.
- A missing-location request has its own status: `pending`, `approved`, or
  `declined`.

## Notification strategy

### MVP

- Automatic email to the owner for a new booking and important exceptions.
- Automatic WhatsApp messages to the customer for confirmation and status changes.
- A visible status link for customers who do not provide email.
- Local development adapters that log notification attempts without credentials.

### Later

- Automated WhatsApp Business Platform messages.
- SMS or push notifications if customer behavior shows they are necessary.
- Driver-facing status updates.

## Technical direction

- Mobile-first React/Vite PWA.
- Cloudflare Pages for the frontend.
- Cloudflare Workers for the HTTP API.
- Cloudflare D1 for the first database.
- Resend behind a notification interface for transactional email.
- No native app, payment integration, live GPS tracking, or interactive map API in
  the MVP. Curated locations may store Google Maps URLs and coordinates.

## Domain data

- `owner_users`
- `customers`
- `service_locations`
- `fare_rules`
- `fare_change_history`
- `operating_schedules`
- `schedule_exceptions`
- `bookings`
- `booking_events`
- `location_requests`
- `notification_deliveries`

## Delivery sequence

### Phase 0 — Confirm operating decisions

- Confirm the booking rules below.
- Confirm initial Umuahia locations, routes, prices, operating hours, and owner
  notification details.

### Phase 1 — Customer booking slice

- Scaffold the application and local database.
- Build the mobile booking flow.
- Add fare preview and booking confirmation.
- Add booking reference and private status link.

### Phase 2 — Owner dispatch slice

- Add secure owner sign-in.
- Add booking queue and status actions.
- Add schedule controls.
- Add email notification boundary with a local development fallback.

### Phase 3 — Configuration and recovery

- Add location and fare management.
- Add fare history and fare snapshots.
- Add new-location request review and requester notification.
- Add automatic WhatsApp provider boundary and delivery status handling.

### Phase 4 — Verification and polish

- Unit-test business rules.
- Run typecheck, lint, build, and tests.
- Exercise duplicate submissions, refreshes, invalid input, and mobile layouts.
- Review the changed code for reuse, accessibility, and visual consistency.

## Explicitly out of scope for MVP

- Direct Bolt integration.
- Online payments or wallet balances.
- Driver accounts or a driver app.
- Live location sharing.
- Automated driver assignment.
- Ratings, reviews, promo codes, and loyalty points.
- Multi-branch permissions.
- Full customer profile management.
- Map-based address search.

## Clarifications required before implementation

These decisions materially change the build and should be answered before code
starts:

1. The brand is **Asa Bolt**, held in one global configuration value so it can
   change later without rewriting user-facing copy.
2. New bookings and status changes use automatic email and automatic WhatsApp
   notifications. Both providers are environment-configured; local development
   uses safe adapters that do not require production credentials.
3. Customers provide a phone number only. Customer confirmations and updates are
   sent to the phone through WhatsApp where configured.
4. Pickup and destination locations are stored in the database and can include a
   Google Maps URL/coordinates. The first UI uses published locations and a
   landmark note; map autocomplete is not required for the first local build.
5. Bookings are automatically approved when they fall within an available
   schedule. Either party may cancel only with a required reason.
6. Payment is handled outside the app for the MVP.
7. The owner has one password-protected account configured through the local
   environment.
8. Routes, prices, schedules, locations, and notification details use clearly
   labelled dummy seed data until the owner's real details are supplied.
9. Booking statuses are `requested`, `confirmed`, `picked_up`, `arrived`,
   `completed`, and `cancelled`. The initial booking is automatically confirmed.

## Completion standard

The MVP is complete when a fresh customer can create a booking, the owner can
manage it, a status change is visible to the customer, a missing location can be
reviewed, and all of those flows work on a narrow mobile viewport with visible
success and failure feedback.
