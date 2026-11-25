# BakeryOS — Product Requirements Document

**Version:** 1.2  
**Status:** Approved for demo MVP  
**Project:** Stonify AI full-stack take-home assignment  
**Product language:** English

## 1. Problem and goal

A small bakery currently takes bread and pastry reservations over the phone. Staff manually track requests and estimate how much to bake. This creates administrative overhead, uncertainty, and a risk of overcommitting inventory.

**BakeryOS** provides a customer-facing reservation flow and a small internal administration dashboard. Its primary value is turning reservations into an actionable daily production recommendation.

### Success criteria

- Customers can reserve several products for one pickup date without registering.
- The bakery can record telephone reservations in the same system.
- Two concurrent reservations cannot claim the same final available unit.
- Staff can see how many units to bake, including expected walk-in demand.
- Reviewers can try the working application and sign in to its demo admin account.

## 2. Users

**Customer:** Wants to reserve bakery products quickly and collect them during opening hours. No customer account is required.

**Bakery administrator:** Manages products, daily production capacity, phone reservations, pickup status, and cancellations. The MVP has one bakery location and one administrator account.

## 3. Customer journey

1. Choose a pickup date.
2. Browse products offered on that date and their currently reservable quantities.
3. Add products and quantities to a cart.
4. Provide a required name and phone number.
5. Submit the reservation; the server validates all items and confirms the whole cart or none of it.
6. See a human-readable reservation number, itemized prices, total, pickup date, and private management URL.
7. Optionally reopen the management URL and cancel before the cutoff.

Payment occurs at pickup. There are no customer accounts, emails, or SMS notifications.

## 4. Customer requirements

### 4.1 Dates and cutoff

- Pickup date is selected **before** the product catalog.
- Pickup dates range from **tomorrow through today + 7 days** (Prague calendar), subject to bakery opening days and exceptional closures.
- The booking cutoff is **18:00 on the previous calendar day**, in the `Europe/Prague` timezone, when production for the day is planned.
- Reservations, online or by phone, cannot be made after that cutoff, including on the pickup date itself.
- No pickup time slots: customers collect during opening hours.
- Products may have configured production weekdays.

### 4.2 Catalog and cart

- Show product name, optional description and image, current price, and remaining reservable quantity.
- Support multiple products and positive integer quantities per reservation.
- Online reservations are limited to **20 units per product** and **50 units per reservation**. Larger orders are placed by phone.
- Do not allow a customer to knowingly add more than the displayed available quantity.
- Availability displayed in the catalog is informational; the server must recheck it at submission.
- Changing the pickup date revalidates the cart and clearly identifies unavailable products or quantities. Do not silently remove or modify items.
- Prices and totals are calculated authoritatively on the server.

### 4.3 Confirmation and self-service

- Required customer fields: name and phone number. Phone numbers are lightly validated: an optional leading `+` followed by 9–15 digits, with spaces, dashes, and parentheses ignored.
- Reservation is confirmed automatically if all rules pass.
- Show reservation number, date, products, quantities, prices, total, and management URL.
- A private, unguessable management URL allows viewing and cancelling the reservation.
- Customers may cancel **strictly before** the cutoff; they cannot edit an existing reservation.
- No public reservation lookup by reservation number.

## 5. Administration requirements

### 5.1 Authentication

- One pre-created administrator account using email and password.
- Secure login and logout.
- No public registration or password-reset flow in the MVP.

### 5.2 Products

- Create, update, and deactivate products.
- Product fields: name, optional description, optional image, price, active flag, default daily maximum capacity, default planned walk-in quantity.
- Product production weekdays can be seeded/configured; an admin editor is deferred.
- Deactivation prevents new reservations but does not alter historical reservations.
- Changing price/name does not alter already-confirmed reservation line items.

### 5.3 Reservations

- View reservations by pickup date.
- See customer name, phone, items, totals, source, and status.
- Create a reservation manually for a customer who phones the bakery.
- **Phone reservations follow the same date rules as online reservations:** tomorrow through today + 7 days, and not after the previous-day 18:00 cutoff. Same-day and other late phone orders are not taken in the system, because that day's production is already planned; spare units are sold over the counter as walk-in stock.
- Admin manual reservations obey bakery opening days, product weekdays, and all capacity constraints. Online per-order quantity limits do not apply to admin reservations.
- Mark a confirmed reservation as `picked_up`, `cancelled`, or `no_show`.
- No editing existing reservations: cancel and recreate instead.
- `picked_up` and `no_show` are only available on or after pickup date.
- Cancellation is not available once the pickup date has passed.
- Terminal statuses cannot be changed in the MVP.

### 5.4 Production planning

For each product and date, show:

- Maximum daily capacity.
- Active reserved quantity.
- Late-cancelled quantity retained for production.
- Planned walk-in quantity.
- Recommended production quantity.
- Remaining reservable quantity.

Admin may override capacity and walk-in allocation for a particular date, even after cutoff, provided existing commitments are respected.

### 5.5 Schedule

- Weekly opening days and exceptional closures determine eligible dates.
- Product production weekdays determine whether a product is offered on a date.
- Schedule configuration may be managed via seed/server configuration in the MVP; dedicated admin screens are deferred.

## 6. Core business rules

This section is the canonical statement of business behavior. `TDD.md` §4 restates these rules in technical form; keep both in sync.

### 6.1 Capacity and production

For a product/date:

```text
committedQuantity = activeReserved + retainedCancelled
remainingAvailability = capacity - walkInQuantity - committedQuantity
recommendedProduction = committedQuantity + walkInQuantity
```

Committed quantities include reservation items with status `confirmed`, `picked_up`, `no_show`, and `cancelled` **only if** `retain_for_production = true`.

The system must never accept a reservation or daily-plan edit that results in negative remaining availability.

### 6.2 Cancellation

- Customer cancellation is allowed only while `confirmed` and before cutoff.
- Admin may cancel a `confirmed` reservation before or after cutoff.
- Cancellation before cutoff releases reserved capacity.
- Cancellation at or after cutoff retains production commitment, because production may already be planned or underway.
- Late cancellation remains visible separately in the production view.

### 6.3 Reliability

- Multi-item reservations are all-or-nothing.
- Concurrent requests must not oversell.
- Retrying the same reservation submission must not create duplicates.
- An idempotent retry should return the original confirmation and management link.
- Validation failures must be understandable to the customer.
- Public reservation creation and admin login are rate-limited to reduce abuse.

## 7. Screens

### Customer

1. Pickup-date selection and product catalog.
2. Cart and customer-details form.
3. Reservation confirmation.
4. Reservation management and cancellation.

### Admin

1. Login.
2. Reservation list filtered by date, with manual creation and status actions.
3. Product management.
4. Daily production overview and date-specific capacity edits.

The interface should be mobile-friendly, accessible, simple, and visually warm, with Czech UI copy. API error messages remain in English.

## 8. Scope prioritization

### P0 — Must ship

- Complete online reservation flow.
- Accurate product/date availability and atomic concurrency protection.
- Secure reservation management URL and customer cancellation.
- Admin authentication.
- Basic product CRUD/deactivation.
- Admin reservation list, manual phone reservations, and status changes.
- Default and date-specific capacity/walk-in settings.
- Production recommendation with retained late cancellations.
- Publicly accessible demo with credentials.

### P1 — Deferred

- Admin UI for opening hours, closures, and product weekdays.
- Print-friendly production sheet.
- Advanced filters, search, and analytics.
- More polished image upload and media management.

### Out of scope

- Customer accounts, online payments, email/SMS notifications, pickup time slots, reservation editing, multiple bakery locations, loyalty programs, and integrations with POS or inventory systems.

## 9. Acceptance scenarios

1. **Normal booking:** A customer selects an eligible date and reserves multiple products, then receives a valid management URL.
2. **Capacity conflict:** A cart requesting more than remaining capacity is rejected entirely, with an actionable message.
3. **Concurrent final unit:** Two customers attempt to reserve the final unit; at most one succeeds.
4. **Retry:** Resubmitting the same request does not create another reservation and returns the original confirmation.
5. **Early cancellation:** A customer cancels before cutoff; capacity is released.
6. **Late customer cancellation:** Cancellation at or after cutoff is rejected.
7. **Late admin cancellation:** Admin cancels after cutoff; committed production quantity does not decrease.
8. **Phone order:** Admin creates a reservation before cutoff when capacity remains; an over-capacity order or one after cutoff is rejected.
9. **Daily plan override:** Admin cannot reduce capacity below walk-in allocation plus existing commitments.
10. **Product changes:** Old reservations retain their original product names and prices.
11. **Admin protection:** Unauthenticated users cannot read or modify administrative data.

## 10. Demo and evaluation

Deliver a working public URL and admin login credentials. Be prepared to explain why the solution uses transactional capacity control, how late cancellations affect production, and which features were intentionally excluded to keep the MVP focused.

**Technical implementation details are specified in `TDD.md`; build order and checkpoints are in `IMPLEMENTATION_PLAN.md`.**
