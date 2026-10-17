# Asa Ride developer handover

Complete a simple, mobile-first ride booking service with two portals: an Admin Portal and a User Facing Portal. The admin controls prices, requests, schedules, notifications, and calendar linking. Anyone can request a ride using their email, without signing up.

Use this handover as the current product direction. Update the older phone-only and automatic-confirmation instructions in `README.md` and `plan.md` as the work is completed. Free access means using the portal is free; users still see and agree to a ride price.

## What is already in the project

The code contains a starting point for booking forms, private booking status links, admin sign-in, a booking queue, schedules, closed dates, locations, and route fares. It uses React/Vite, a Node API, and SQLite.

The current `src/App.tsx` displays a coming-soon page. Connect the existing screens to proper navigation before treating either portal as available.

The existing booking flow requires a name and phone number and creates bookings as confirmed. Change this to the email-based request and approval flow below. Area pricing, negotiations, email request history, notification settings in the admin, and calendar linking still need to be added. Notification code currently provides console and generic webhook adapters; real message delivery still needs to be connected and checked.

These are findings from the source code, not a completed manual check of the app.

## How a ride request should work

1. The user enters their email before making a request.
2. They select a start location, destination, and pickup date and time.
3. The system shows the price calculated from the admin's current settings.
4. The user chooses **Accept price** or **Negotiate price**. Negotiation lets them enter their proposed amount and an optional note.
5. Save the request and show **Pending approval**, with a request reference. Notify the admin and email the user a receipt with a private status link.
6. The admin sees the route, pickup time, email, calculated price, and proposed price. They accept or reject the request. An accepted negotiation uses the proposed amount as the agreed fare.
7. Email the decision to the user and update their request history. A ride is confirmed only after admin acceptance.

Keep negotiation to one offer and one admin decision. A rejected request shows the reason and allows the user to make a new request.

**Suggested expiry rule:** keep an unanswered request pending until its pickup time, then mark it rejected with “Not accepted before pickup time.” Confirm this cutoff with the owner before implementing it. Silence must never confirm a ride.

Keep the existing pickup, arrival, completion, and cancellation steps after acceptance. Record who changed the status and when. Keep rejection separate from cancellation.

## Admin Portal

Provide a private admin sign-in and these simple sections:

| Section               | Work to complete                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests              | Show pending, accepted, rejected, cancelled, and completed requests. Filter by date and status, search by email or reference, view details, and accept or reject requests and negotiated fares. |
| Schedule              | View upcoming accepted rides, edit operating hours, close or reopen dates, and reschedule or cancel a ride with a reason and a customer update. Flag overlapping rides before acceptance.       |
| Pricing and locations | Manage service areas, pickup and destination locations, route distances, rates per kilometre, and fixed route prices. Preview the resulting rounded fare before saving.                         |
| Notifications         | Configure admin recipients, email and optional WhatsApp messages, which events send messages, and message text. Show connection status, failed sends, and a retry action.                       |
| Calendar              | Link the admin's chosen calendar and show whether the connection is working. Add accepted rides and update their events when rescheduled or cancelled.                                          |

Start calendar linking with one provider agreed with the owner. Keep the app as the place where rides are managed. Store the external event ID so retries update the same event. A failed calendar update should be visible and retryable while the accepted request stays saved.

Email is the main customer channel. Ask for an optional WhatsApp number when the user wants WhatsApp updates. Keep any bot limited to booking notifications and links back to the portal. Store provider credentials securely on the server.

## User Facing Portal

Provide three main screens: **Request a ride**, **Request details**, and **My requests**.

Keep access open to everyone, with no signup or password. Use email to group requests. For **My requests**, send a short-lived private link to the entered email before showing history. Entering someone else's email alone must not reveal their rides.

Show all requests for the verified email, newest first, including pending and rejected requests. Each item should show its reference, route, pickup time, status, quoted price, proposed price where applicable, and agreed price once accepted. Allow the user to open the full details.

Make both portals work comfortably on a phone: short forms, large buttons, readable prices, clear status messages, and no horizontal scrolling for normal tasks. Show useful loading, empty, success, and error messages. Prevent duplicate requests from repeated taps.

## Pricing and the output research

Use [the research workbook](outputs/abia_google_maps_distance_matrix/abia_google_maps_distance_matrix.xlsx) as the starting dataset. Its sheets are `Calculator`, `Locations`, `Routes`, `LGA Map`, and `Sources`.

The workbook records 27 reference locations and 351 route pairs, collected on 14 September 2026. It uses School Road to Umudike as a reference: 9.8 km for ₦10,000. That gives a suggested starting rate of ₦10,000 ÷ 9.8, or about ₦1,020.41 per km. This is a workbook assumption for the admin to review, not an approved fare for every area.

Use kilometres consistently because that is the unit in the research. Import the locations and route distances, retain their source links, and let the admin review and publish the routes they serve. The workbook treats each route pair as reversible. Use that as the initial distance assumption and allow the admin to correct distances or set a different price for either direction.

### Simple calculation

1. Use an active fixed route price if the admin has set one.
2. Otherwise, multiply the route distance by the applicable area's rate per kilometre.
3. Round the final amount up to the next ₦50.

**Suggested area rule:** let the admin assign one pricing area to each route. Use that area's rate, falling back to an admin-configured default rate. This keeps routes between different areas predictable. Confirm this choice with the owner before implementing it.

For example, an illustrative 8.12 km route at ₦100 per km produces ₦812, which becomes **₦850**. The admin must be able to change the default rate, area rates, route assignments, distances, and fixed route prices without a code change.

### Rounding

Use `final price = ceiling(amount / 50) × 50`. This matches the requested examples:

| Amount before rounding | Price shown |
| ---------------------- | ----------- |
| ₦812                   | ₦850        |
| ₦999                   | ₦1,000      |
| ₦850                   | ₦850        |
| ₦1,001                 | ₦1,050      |

Apply the same rule to calculated prices, admin fixed prices, and negotiated amounts. Show the rounded negotiation amount before the user submits it. Round only the final fare; retain the full rate precision during calculation. Display fares as whole naira amounts.

The workbook currently rounds to the nearest naira. Replace that behaviour in the app with the upward ₦50 rule.

Calculate and validate prices on the server. If the price changes between preview and submission, show the new price and let the user agree again. Save the distance, rate or fixed price used, rounded quote, proposed amount, and agreed amount with the request. Later pricing changes should affect new quotes while preserving existing requests.

If a route has no usable distance or price, explain that it is unavailable and let the user request that location or contact the admin. Never show a guessed or zero fare.

## Suggested work order

1. Connect the customer and admin screens. Use one consistent product name across them.
2. Add email-based requests and secure email access to request history. Preserve existing records when updating the database; keep older phone-only bookings available to the admin.
3. Import the research data and complete admin pricing controls, area rates, and rounding.
4. Add negotiation, pending approval, acceptance, rejection, and the agreed expiry rule. Update both portals and notifications together.
5. Complete schedule editing, notification settings, real message delivery, and calendar linking.
6. Manually check the full journey on a phone-sized screen and prepare the app for release with real settings, persistent database storage, backups, and working private admin access.

Reuse the existing project structure. Keep the implementation focused on these two portals and the booking flow.

## Where to start in the code

| Files                                                                                                       | Purpose                                                           |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/App.tsx`, `src/components/CustomerPage.tsx`, `src/components/BookingPage.tsx`                          | App entry point and customer booking screens.                     |
| `src/components/OwnerPage.tsx`, `src/components/StatusPage.tsx`, `src/components/CustomerStatus.tsx`        | Admin controls and booking status screens.                        |
| `shared/contracts.ts`, `shared/config.ts`                                                                   | Shared request fields, statuses, and product settings.            |
| `server/application.ts`, `server/domain/rules.ts`, `server/routes/http.ts`                                  | Booking creation, approval rules, price handling, and API routes. |
| `server/infrastructure/database.ts`, `server/infrastructure/repository.ts`, `server/infrastructure/seed.ts` | Stored data, database changes, and initial data.                  |
| `server/infrastructure/notifications/index.ts`                                                              | Existing notification adapters to extend.                         |

## When the project is complete

Manually demonstrate these outcomes:

- The admin changes an area's rate and a new customer quote reflects it with the correct rounding.
- A user requests a ride at the fixed price or submits a negotiation using email, without signing up.
- The admin accepts or rejects the request, and the user sees the correct decision and agreed price.
- An unanswered request follows the agreed expiry rule and never becomes confirmed automatically.
- A user securely opens all their historical requests through their email, including rejected requests.
- Closed dates and operating hours are respected during booking and admin approval.
- Accepted rides appear in the linked calendar. Rescheduling and cancellation update the same event.
- Real email and configured WhatsApp messages arrive. Failed deliveries can be retried without duplicating the request.
- Both portals are usable on mobile, and existing request prices stay unchanged after pricing edits.

Follow the owner's working rules: ask before using Chrome tools, complete manual checks before requesting permission to write tests, and get explicit permission before regression tests. Do not run builds; use only the permitted formatting and lint checks. Do not use subagents.
