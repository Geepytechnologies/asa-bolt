# Asa Ride feature testing checklist

Prepared 29 October 2026 for stakeholder testing. Use the checkboxes to record a new test run;
unchecked items do not mean the feature is unimplemented. Record any failure with the steps,
request reference, expected result, and actual result. Keep credentials, private links, customer
information, and generated test evidence out of Git.

The implementation has been tested locally. Deployment verification, live Google Calendar access,
and signed Resend delivery callbacks remain pending. See [TODO.md](TODO.md) for release status and
[RUNBOOK.md](RUNBOOK.md) for configuration and operating instructions.

## Before testing

- Follow [Local setup](README.md#local-setup) using Node.js 24 or newer. Preserve an existing `.env`.
- Open the customer portal at `http://localhost:5173` and admin portal at
  `http://localhost:5173/admin`. Use the configured admin password privately.
- In admin, publish the test locations and route, set its pricing, and confirm operating hours.
  Imported research routes start as drafts. Review and publication are normal admin operations.
- Use future pickups within open hours. Scheduling dates and times use Africa/Lagos.
- Use an authorized test inbox for email checks. A configured provider sends real messages.
- Use separate requests for acceptance, rejection, cancellation, expiry, and ride completion.
  Acceptance and rejection cannot be reversed into each other.

## Customer portal

- [ ] **1. Request a ride without signing up.** Enter an email, pickup location, destination,
      and pickup time. No customer account, password, name, or phone number is required.
- [ ] **2. View the calculated fare.** Select a published route and pickup time. A usable route
      shows its fare before submission. A route without usable pricing shows a clear unavailable
      message and does not permit a guessed or zero fare.
- [ ] **3. Accept or negotiate the price.** Accept the displayed fare, or enter one proposed
      amount and an optional note. The rounded offer is shown before submission. There is one
      offer and one admin decision; offer editing and counter-offers are outside this flow.
- [ ] **4. Pending requests and duplicate prevention.** Submit a request and confirm that it
      receives a reference and shows Pending approval. Repeated taps must not create extra requests.
- [ ] **5. Private request details.** Open the private status link. Check the route, pickup time,
      status, original quote, proposed amount where applicable, and agreed fare after acceptance.
      Rejection and cancellation reasons should be visible when applicable.
- [ ] **6. Secure request history.** Request a My requests email link and verify that entering an
      email alone reveals no bookings. Use the link to view only that email's requests, newest
      first, including pending and rejected requests. A used or expired link must fail. Logging
      out must remove history access; full request details should open from verified history.
- [ ] **7. Customer cancellation.** Cancel an eligible request using its private link, matching
      email, and a reason. Confirm the cancelled status and reason. A different email must fail.
- [ ] **8. Request a location.** Submit a suggestion for an unsupported location. Confirm that
      it appears for admin review and can be approved or declined with a response note.

## Admin requests and scheduling

- [ ] **9. Private admin access.** Check correct-password sign-in, rejection of incorrect passwords,
      and sign-out. Private admin data and actions must require authentication.
- [ ] **10. Request search and filters.** Search by email or reference, filter by pickup date and
      status, and navigate between result pages. Open details and confirm the selected request
      matches its reference, route, contact details, and saved prices.
- [ ] **11. Accept or reject requests.** Accept a standard request at its saved quote and a
      negotiated request at its rounded offer. Reject a separate request with a reason. Repeating
      the same decision must not duplicate status events or notifications.
- [ ] **12. Ride progress and audit history.** Move an accepted ride through picked up, arrived,
      and completed. Check that invalid status transitions are refused and the history records
      who changed the status and when. Keep rejection separate from cancellation.
- [ ] **13. Operating hours and closed dates.** Add, edit, and disable weekly pickup windows;
      close and reopen a date. Booking and acceptance must respect availability. Active windows
      cannot overlap. Closing a date flags affected accepted rides without silently moving or
      cancelling them.
- [ ] **14. Rescheduling and admin cancellation.** Change a pending or accepted ride to a future
      pickup within open hours, supplying a reason. Confirm updated customer details/history and
      the schedule audit. A stale edit must fail; repeating an identical save must not duplicate
      updates. Cancel a separate eligible ride with a reason. Saved prices must remain unchanged.
- [ ] **15. Possible scheduling conflicts.** Accept one ride, then accept or reschedule another
      ride on the same Lagos pickup date. Confirm a warning appears and the admin can proceed
      after review. Exact pickup-time matches are distinguished. A changed conflict list requires
      another review. No duration or travel buffer is assumed; cross-date overlaps are not detected.
- [ ] **16. Automatic request expiry.** Leave a request unanswered until its pickup time. While
      the server is running, it should become rejected with “Not accepted before pickup time.”
      The worker checks every five seconds and catches up after startup. Accepted rides must
      remain accepted; silence must never confirm a request.

## Locations and pricing

- [ ] **17. Locations, routes, and research data.** Manage service locations, edit distances, and
      publish or unpublish routes. Confirm the imported 27 research locations and 351 route pairs
      are represented as 702 directional drafts with source references. Editing one direction
      must not silently change the opposite direction.
- [ ] **18. Area, default, and fixed pricing.** Create or edit a pricing area and assign it to a
      route. Its rate should apply when set; clearing its rate or removing the assignment uses
      the default rate. An active fixed price effective on the pickup date takes priority. Preview
      the fare before saving, then confirm that a new customer quote reflects saved changes.
- [ ] **19. Upward ₦50 rounding and price protection.** Check the examples below for calculated,
      fixed, and negotiated fares. If a quote changes before submission, the customer must review
      and agree again. Later pricing edits must preserve existing requests' quotes, offers, agreed
      fares, and saved pricing details.

| Test input                             | Expected price |
| -------------------------------------- | -------------- |
| 8.12 km at a default rate of ₦100/km   | ₦850           |
| 8.12 km at an assigned rate of ₦150/km | ₦1,250         |
| Fixed route price of ₦999              | ₦1,000         |
| Negotiated amount of ₦812              | ₦850           |
| Amount already at ₦850                 | ₦850           |
| Amount of ₦1,001                       | ₦1,050         |

## Notifications, integrations, and general checks

- [ ] **20. Notification settings and email delivery.** Configure admin recipients, event switches,
      and message text. Check customer receipts, admin alerts, acceptance, rejection, schedule
      changes, cancellation, ride progress, expiry, and history emails. Confirm disabled events
      and recipients are respected. Review delivery records and attempt details; retry an eligible
      failure without duplicating the request or provider message. Distinguish provider acceptance
      from confirmed delivery. Signed Resend callbacks require a deployed endpoint and configuration.
- [ ] **21. Google Calendar linking — live setup required.** With blank credentials, confirm the
      admin sees Not configured and can still manage rides. Once credentials are supplied, connect
      the intended account and select a writable calendar. Accepted rides should create private
      pickup markers; rescheduling and cancellation should update the same event. Pending and
      rejected requests must not create events. Failed updates must be visible and retryable while
      the accepted request remains saved. Pickup markers do not represent estimated ride durations.
- [ ] **22. Mobile usability and persistence.** Check both portals on desktop and phone-sized
      screens: readable prices, usable forms/buttons/navigation, no normal-task horizontal scrolling,
      and clear loading, empty, error, and success states. Restart the app and confirm that requests,
      saved prices, schedules, and notification settings persist. Admin sessions require sign-in
      again after a server restart. For backup/restore checks, follow the runbook and restore to a
      separate database file.

## Optional WhatsApp checks

WhatsApp consent fields, admin controls, and a provider adapter interface are implemented. Live
delivery requires a separately configured and verified provider; handset delivery callbacks are
not implemented.

- [ ] Confirm WhatsApp starts disabled and a missing provider is reported clearly.
- [ ] When enabling the configured integration, check explicit customer opt-in, number validation,
      event settings, delivery records, retry behavior, and opt-out. An existing phone number alone
      must not imply consent.

## Scope and remaining live checks

- Resend app-generated emails were tested locally. Public history/status links and signed delivery
  callbacks still need verification after deployment. Provider-reported delivery means acceptance
  by the recipient's mail server; it does not establish inbox placement.
- Google Calendar was tested using a provider simulation. Actual account configuration and live
  event verification remain pending.
- Deployment, HTTPS, persistent production storage, off-host backups, and recovery checks remain
  release tasks described in [TODO.md](TODO.md) and [RUNBOOK.md](RUNBOOK.md).
- Payments, live GPS, driver accounts/assignment, ratings, map autocomplete, ride duration estimates,
  and travel buffers are outside the current scope.
