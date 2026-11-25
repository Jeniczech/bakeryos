# BakeryOS — Technical Design Document

**Version:** 1.2  
**Status:** Approved for implementation  
**Project:** Stonify AI take-home assignment  
**Target:** Working demo MVP in approximately 2–3 focused development days

## 1. Architecture and principles

Build a **single Next.js App Router full-stack monolith**. Keep transport, application services, domain logic, and persistence clearly separated without introducing microservices, dependency-injection frameworks, or generic repository layers.

```text
Customer UI / Admin UI
  ├── Server Components (server-side reads)
  ├── Server Actions (authenticated admin mutations)
  └── Route Handlers (public reservation API)
                 │
          Application Services
             ├── Pure domain rules
             └── Drizzle ORM
                     │
                PostgreSQL
```

Prioritize correctness of reservation capacity, straightforward implementation, and demo readiness.

## 2. Technology stack

| Area | Technology |
|---|---|
| Framework | Next.js App Router |
| Language | TypeScript strict mode |
| UI | React + Tailwind CSS |
| Database | PostgreSQL |
| ORM and migrations | Drizzle ORM / Drizzle Kit |
| Validation | Zod |
| Admin authentication | Auth.js Credentials provider |
| Password hashing | Argon2id (e.g. `@node-rs/argon2`; deployed compatibility verified in Stage 1) |
| Session | Auth.js JWT session in secure HttpOnly cookie |
| Unit and integration tests | Vitest |
| E2E | Playwright |
| Local database | Docker Compose PostgreSQL |
| Hosting | Netlify |
| Production database | Neon PostgreSQL |
| Business timezone | Europe/Prague |

Use compatible stable dependency versions. **Payload CMS is intentionally excluded**; the admin is a custom React interface.

### 2.1 Database driver requirement

All capacity-sensitive workflows require **connection-bound interactive PostgreSQL transactions** and `SELECT ... FOR UPDATE`. Use a compatible Drizzle driver (for example `pg` with a suitable Neon connection string). Do not use Neon's stateless HTTP query interface for transactional reservation workflows. Verify this with a minimal deployed spike before committing to the full implementation.

- **Runtime connections** use Neon's **pooled** connection string (`DATABASE_URL`), to avoid exhausting connections from serverless functions. The pooler runs in transaction mode; the spike must confirm that interactive transactions and `SELECT ... FOR UPDATE` behave correctly through it.
- **Migrations** use the direct (unpooled) connection string (`DATABASE_URL_UNPOOLED`) if the migration tooling requires session-level features.

**Verified in Stage 1:** Drizzle with `drizzle-orm/node-postgres` (`pg` Pool) through Neon's pooled connection, on a Netlify Deploy Preview (Linux x64, Node 24). Ten concurrent `SELECT ... FOR UPDATE` claims for one unit, both within one function and across function instances, produced exactly one claim and a consistent final row; a no-lock baseline oversold, confirming the test detects lost updates. Neon runs PostgreSQL 18 in AWS `us-east-2`, co-located with Netlify Functions (`us-east-2`); local Docker also uses PostgreSQL 18.

### 2.2 Password hashing requirement

Argon2id hashing and verification must work inside a **deployed Netlify Function**, not only at build time. Keep Argon2id if compatible; if it is not, propose an alternative and obtain approval before changing the hashing approach.

**Verified in Stage 1:** `@node-rs/argon2` (prebuilt native binaries, no `node-gyp`) with Argon2id defaults `m=19456, t=2, p=1` hashes and verifies inside a deployed Netlify Function (~30–60 ms per operation). Deployments must be built by Netlify from Git: a local `netlify deploy` from macOS bundles the wrong native binary.

## 3. Product scope

### P0

- Customer pickup-date selection, product catalog, cart, checkout, confirmation, management URL, and cancellation.
- Atomic multi-product reservations, availability and idempotency.
- Admin login/logout, product CRUD/deactivation, reservation overview, manual phone reservations, status updates, daily production, and capacity overrides.
- Late-cancellation production retention.
- Mobile-friendly English UI.

### Deferred

- Customer accounts, online payments, notifications, reservation editing, pickup slots, multi-location support, advanced reporting, print view, and admin screens for opening days/closures/product weekdays.

See `PRD.md` for user journeys and acceptance scenarios.

## 4. Business policies

`PRD.md` §4–6 is canonical for business behavior; this section restates it in technical form. Keep both in sync.

### 4.1 Pickup dates and cutoff

- Date is selected before browsing products.
- Booking windows (Prague calendar dates, inclusive), on bakery-open dates and product-eligible weekdays:
  - **Online:** `today + 1` through `today + 7`.
  - **Admin:** `today` through `today + 7`.
- **Online cutoff: 18:00 on the previous calendar day in `Europe/Prague`.** Thus same-day online reservations are never available.
- Admin-created reservations may **bypass the online cutoff**, including booking for today, but cannot use a past pickup date.
- Admin-created reservations still obey bakery-open dates, product weekdays, and all capacity constraints.
- Source (`online` or `admin`) is assigned by trusted server code; public callers cannot choose `admin`.

### 4.2 Availability and production

```text
committedQuantity = activeReserved + retainedCancelled
remainingAvailability = capacity - walkInQuantity - committedQuantity
recommendedProduction = committedQuantity + walkInQuantity
```

Committed reservation items have status `confirmed`, `picked_up`, `no_show`, or `cancelled` with `retain_for_production = true`.

All successful writes must preserve:

```text
capacity >= walkInQuantity + committedQuantity
```

### 4.3 Cancellation and status transitions

- Customer: `confirmed → cancelled` **strictly before cutoff** only; `retain_for_production = false`.
- Admin: `confirmed → cancelled` before or after cutoff; set `retain_for_production = (cancelledAt >= cutoff)`.
- Admin: `confirmed → picked_up` or `confirmed → no_show`, only on or after pickup date.
- `picked_up`, `cancelled`, and `no_show` are terminal in the MVP.
- Cancellation at the exact cutoff counts as late.
- Early cancellation releases capacity; late cancellation retains the production commitment.
- Do not edit an existing reservation: cancel and recreate.

### 4.4 Pricing and product history

Store money as integer **CZK haléře**. Load prices from the database at reservation creation; never accept authoritative prices from the client. Store product-name and unit-price snapshots on reservation items. Product deactivation blocks new reservations but preserves history.

### 4.5 Order limits and customer input

- **Online** reservations: at most **20 units per product** and **50 units per reservation**. Enforced in the Zod schema and again in `createReservation` for `source = 'online'`. Admin reservations are bounded only by capacity.
- Phone normalization: strip spaces, dashes, and parentheses; require `^\+?\d{9,15}$`; store the normalized form. Normalization happens before the canonical request hash is computed.
- Customer name: trimmed, 1–100 characters.

## 5. Database schema

Use UUID primary keys, appropriate foreign keys, timestamps, and explicit constraints. Drizzle schema and migrations are authoritative.

### 5.1 `admin_users`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK |
| `email` | TEXT | Unique, required |
| `password_hash` | TEXT | Required, Argon2id |
| `created_at` | TIMESTAMPTZ | Required |

Seed one admin account; no registration or password reset.

### 5.2 `products`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | Required |
| `description` | TEXT | Nullable |
| `image_url` | TEXT | Nullable |
| `price` | INTEGER | `>= 0`, haléře |
| `active` | BOOLEAN | Default true |
| `default_capacity` | INTEGER | `>= 0` |
| `default_walk_in_quantity` | INTEGER | `>= 0`, `<= default_capacity` |
| `created_at`, `updated_at` | TIMESTAMPTZ | Required |

### 5.3 `daily_product_plans`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK |
| `product_id` | UUID | FK products |
| `date` | DATE | Required |
| `capacity` | INTEGER | `>= 0` |
| `walk_in_quantity` | INTEGER | `>= 0`, `<= capacity` |
| `created_at`, `updated_at` | TIMESTAMPTZ | Required |

Unique `(product_id, date)`.

**First-write snapshot:** On the first write for a product/date, create a plan using the product's then-current default capacity and walk-in allocation. Use `INSERT ... ON CONFLICT DO NOTHING`. Read-only catalog requests do not materialize plans; they fall back to defaults. Once created, later default changes do not modify that date's plan.

### 5.4 `reservations`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK |
| `reservation_number` | TEXT | Unique, `BK-` + zero-padded value from a PostgreSQL sequence (e.g. `BK-000123`) |
| `pickup_date` | DATE | Required |
| `customer_name` | TEXT | Required |
| `customer_phone` | TEXT | Required |
| `source` | TEXT | CHECK `online` / `admin` |
| `status` | TEXT | CHECK `confirmed` / `picked_up` / `cancelled` / `no_show` |
| `retain_for_production` | BOOLEAN | Default false |
| `management_token_hash` | TEXT | Unique, required |
| `idempotency_key` | UUID | Unique, required |
| `request_hash` | TEXT | Required |
| `created_at` | TIMESTAMPTZ | Required |
| `cancelled_at` | TIMESTAMPTZ | Nullable |

`retain_for_production` is a stored historical decision; do not recompute it from the current date when reading reservations.

Reservation numbers come from a dedicated sequence (`reservation_number_seq`), so no collision retries are needed. Gaps after rolled-back transactions are acceptable. Numbers grant no access, because there is no public lookup by reservation number.

### 5.5 `reservation_items`

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK |
| `reservation_id` | UUID | FK reservations |
| `product_id` | UUID | FK products |
| `product_name_snapshot` | TEXT | Required |
| `unit_price_snapshot` | INTEGER | `>= 0`, haléře |
| `quantity` | INTEGER | `> 0` |

Unique `(reservation_id, product_id)`.

### 5.6 Schedule configuration

- `bakery_opening_days(weekday UNIQUE, is_open)`; weekday 0–6.
- `bakery_closures(date UNIQUE, reason NULLABLE)`.
- `product_weekdays(product_id, weekday)` with unique `(product_id, weekday)`.

Weekdays use `0 = Sunday … 6 = Saturday` (JavaScript `getUTCDay()`, PostgreSQL `DOW`). A product with **no** `product_weekdays` rows is offered on every open day; otherwise only on the listed weekdays. This keeps admin-created products bookable while the weekday editor is deferred.

Seed these tables; schedule-management UI is deferred.

### 5.6.1 `rate_limits`

| Column | Type | Rules |
|---|---|---|
| `key` | TEXT | Part of PK, e.g. `reservations:<ip>` or `login:<ip>:<email-hash>` |
| `window_start` | TIMESTAMPTZ | Part of PK |
| `count` | INTEGER | Required, `>= 0` |

Fixed-window counter updated with a single atomic `INSERT ... ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`. Old windows may be deleted opportunistically. Do not store raw emails in keys.

### 5.7 Indexes and constraints

- Reservations: `(pickup_date, status)`; it also serves `pickup_date`-only queries.
- Reservation items: `product_id`; `reservation_id` lookups use the unique `(reservation_id, product_id)` index.
- Daily plans: unique `(product_id, date)`.
- Reservations: unique `reservation_number`, `management_token_hash`, `idempotency_key`.
- CHECK constraints for status, source, nonnegative quantities/prices, and walk-in <= capacity.
- Reservations: `cancelled_at` is set if and only if `status = 'cancelled'`; `retain_for_production` may be true only when `status = 'cancelled'`.
- Products: `name` must not be blank.
- Cross-table aggregate capacity invariants are enforced by transactions, not CHECK constraints.

## 6. Concurrency and transaction protocol

Use PostgreSQL **READ COMMITTED** and row-level locks. Every operation affecting a product/date's capacity or committed quantity must use the same locking protocol:

1. Begin transaction.
2. Identify affected product/date pairs.
3. Materialize missing daily plans with `INSERT ... ON CONFLICT DO NOTHING`.
4. Lock daily plan rows with `SELECT ... FOR UPDATE` in deterministic ascending product-ID order.
5. **After locks**, re-read mutable reservation/product state and aggregate committed quantities.
6. Validate and perform mutation.
7. Commit.

Avoid acquiring reservation row locks before daily-plan locks in one workflow and reversing the order elsewhere. For status updates, use a conditional update or compatible locking strategy so concurrent transitions cannot both succeed.

### 6.1 `createReservation(input)`

Trusted input includes idempotency key, pickup date, customer name/phone, product IDs/quantities, and server-assigned source.

1. Zod-validate and normalize input (including phone normalization and online quantity limits); merge duplicate product IDs by summing quantities (online limits apply to the merged quantities) and sort items deterministically.
2. Compute canonical request hash from normalized fields **including trusted source**.
3. Begin transaction and check existing idempotency key.
4. If found: compare hashes; return existing confirmation or reject conflicting reuse.
5. Validate the date against the source-specific booking window, bakery opening, product weekdays, and product activity. Apply cutoff **only for online source**.
6. Materialize and lock daily plans in deterministic order.
7. Re-check the idempotency key, then re-read eligibility and aggregate committed quantities after locking. Read the clock again for this check: the lock wait may cross the cutoff.
8. Validate the entire cart against capacity.
9. Read authoritative prices and insert reservation with item snapshots.
10. Commit and return confirmation plus management URL.

All-or-nothing: any unavailable item rejects the entire reservation.

### 6.2 Idempotency

- Every creation request has a UUID idempotency key.
- Same key + same canonical request: return original confirmation.
- Same key + different request: `409 Conflict`.
- Unique database constraint is the final duplicate protection.
- Handle concurrent duplicate insert races by loading the committed reservation after a unique violation and comparing request hashes.
- Use bounded retries only for recognized transient database conflicts.
- Treat idempotency keys as sensitive: a legitimate replay returns a management URL.

### 6.3 Management token and replay

To support idempotent response replay without storing plaintext tokens:

1. Generate a random reservation UUID.
2. Derive a token using HMAC-SHA-256 with a dedicated high-entropy `MANAGEMENT_TOKEN_SECRET` and a domain-separated encoding of the reservation UUID.
3. Store only `SHA-256(token)` in `management_token_hash`.
4. Return the token in the management URL.
5. On legitimate idempotent replay, rederive the same token from the stored UUID.

Management tokens are bearer credentials. Do not log them, include them in analytics, or expose them through public reservation-number lookup. Keep the secret stable across deployments. Rotation/key versioning is deferred for the demo.

### 6.4 `cancelReservation(input)`

1. Resolve reservation through a valid management token or authenticated admin context.
2. Identify affected products and pickup date.
3. Begin transaction, materialize and lock relevant daily plans in deterministic order.
4. Re-read reservation state **after locks**; require `confirmed`.
5. Read the current time **after the locks are acquired** (the lock wait may cross the cutoff) and calculate the exact cutoff for that pickup date in `Europe/Prague`.
6. Reject customer cancellation at or after cutoff; admin cancellation is allowed.
7. Set `status = cancelled`, `cancelled_at = now`, and `retain_for_production = (now >= cutoff)`.
8. Commit.

A repeated cancellation must have no additional side effects; returning the already-cancelled state is acceptable.

Retry only recognized transient database conflicts (deadlock, serialization failure), with the same bounded retries as creation (§6.2).

### 6.5 `updateReservationStatus(input)`

Authenticated admin only. Allow `confirmed → picked_up` and `confirmed → no_show` on or after pickup date. Preserve production commitment. Ensure concurrent competing transitions cannot overwrite one another; use transactionally checked state and a conditional update or compatible row locking.

### 6.6 `updateDailyPlan(input)`

Authenticated admin only. Check eligibility (date and product, as for admin reservations); materialize and lock the plan; re-check eligibility after locking; aggregate committed quantities; reject if:

```text
newCapacity < newWalkInQuantity + committedQuantity
```

Then update the plan and commit. Admin may do this after cutoff and for today, but cannot violate commitments. Plans for past dates (before today in `Europe/Prague`) cannot be changed, because they are production history. The date must also be within the admin booking window (today through today + 7) and a bakery-open date, and the product must be active and offered on that weekday, so no plan is materialized for an ineligible product/date. The past-date check is repeated after locking, because the lock wait may cross midnight.

Returns the updated `DailyProductionItem`. Rejections use typed domain errors: `INVALID_REQUEST` (Zod validation, walk-in above capacity, or a past date), `OUTSIDE_BOOKING_WINDOW` and `BAKERY_CLOSED` (pickup-date errors), `PRODUCT_NOT_FOUND`, `PRODUCT_UNAVAILABLE` (inactive or not offered on that weekday), and `PLAN_BELOW_COMMITMENTS` (with the committed quantity).

## 7. Application services and project layout

Prefer standalone use-case functions and pure domain helpers.

```text
src/
  app/
    (storefront)/
    admin/
    api/
      health/
      products/
      reservations/
        route.ts
        manage/[token]/
          route.ts
          cancel/route.ts
  components/
    storefront/
    admin/
    ui/
  server/
    auth/
    services/
      reservations/
        create-reservation.ts
        cancel-reservation.ts
        update-reservation-status.ts
        get-reservation.ts
        get-daily-reservations.ts
      production/
        get-daily-production.ts
        update-daily-plan.ts
      products/
        create-product.ts
        update-product.ts
        get-available-products.ts
    domain/
      availability.ts
      production.ts
      reservation-rules.ts
      errors.ts
    db/
      client.ts
      schema.ts
      lock-daily-plans.ts
  lib/
    validation/
    date-time/
    formatting/
drizzle/
tests/
  unit/
  integration/
  e2e/
```

### Core service contracts

```ts
type CreateReservationInput = {
  idempotencyKey: string;
  pickupDate: string; // YYYY-MM-DD
  customer: { name: string; phone: string };
  items: Array<{ productId: string; quantity: number }>;
  source: 'online' | 'admin'; // trusted server-side assignment only
};

type CreateReservationResult = {
  reservationId: string;
  reservationNumber: string;
  pickupDate: string;
  // 'confirmed' for a new reservation; an idempotent replay reports the current status.
  status: 'confirmed' | 'picked_up' | 'cancelled' | 'no_show';
  totalPrice: number; // haléře
  items: Array<{ productId: string; productName: string; unitPrice: number; quantity: number }>;
  managementToken: string;
  replayed: boolean; // true for an idempotent replay (route returns 200 instead of 201)
};

type UpdateDailyPlanInput = {
  productId: string;
  date: string;
  capacity: number;
  walkInQuantity: number;
};

type DailyProductionItem = {
  productId: string;
  productName: string;
  capacity: number;
  activeReserved: number;
  retainedCancelled: number;
  walkInQuantity: number;
  recommendedProduction: number;
  remainingAvailability: number;
};
```

Keep domain calculations pure where possible. Services do not return HTTP response objects.

## 8. Public API and errors

### `GET /api/products?date=YYYY-MM-DD`

Return eligible products, prices, and current remaining availability. This is informational; submission revalidates transactionally.

### `POST /api/reservations`

Public handler always assigns `source = 'online'`. Never trust a client-provided source.

```json
{
  "idempotencyKey": "d6c7c4a8-61e2-4a41-89c7-4d3f61b3a825",
  "pickupDate": "2026-11-27",
  "customer": { "name": "Jane Doe", "phone": "+420777123456" },
  "items": [{ "productId": "a-valid-product-uuid", "quantity": 2 }]
}
```

`201 Created` for new reservation; `200 OK` for idempotent replay. Response includes reservation number, pickup date, status, total price, and management URL.

### `GET /api/reservations/manage/:token`

Return reservation details and cancellation eligibility. Invalid tokens return `404` without revealing whether a reservation number exists. Disable caching for sensitive responses.

### `POST /api/reservations/manage/:token/cancel`

Cancel before cutoff; reject late customer cancellation with a domain conflict. Repeated cancellation is side-effect-free.

### Admin mutations

Use authenticated **Server Actions**, not duplicated admin REST endpoints. Admin manual creation calls the same `createReservation` service with trusted `source = 'admin'`.

### Error format

Use **RFC 9457 Problem Details** (`Content-Type: application/problem+json`), typed domain errors, and Zod input validation.

```json
{
  "type": "about:blank",
  "title": "Insufficient capacity",
  "status": 409,
  "detail": "Some products do not have enough remaining capacity.",
  "code": "INSUFFICIENT_CAPACITY",
  "shortages": [
    { "productId": "a-valid-product-uuid", "requested": 2, "available": 1 }
  ]
}
```

A cart can be short on several products at once, so capacity errors list every shortage.

Conventions: `400` malformed input, `401` unauthenticated, `403` forbidden, `404` not found, `409` state/cutoff/capacity/idempotency conflict, `422` semantically invalid input, `429` rate limit exceeded (with `Retry-After`), `500` unexpected error. Never expose SQL details or stack traces.

## 9. Admin interface and authentication

Routes:

- `/admin/login`
- `/admin`
- `/admin/reservations`
- `/admin/products`
- `/admin/production`

Use Auth.js Credentials with Argon2id, a seeded admin user, and secure HttpOnly JWT session cookies. Target eight-hour session lifetime. No public registration or password reset. Check authorization **inside every admin Server Action and server-side read**, not only in layout or middleware.

Admin functions:

- Reservations by pickup date; manual phone reservation; mark picked up, cancelled, or no-show.
- Product create/edit/deactivate; default daily capacity and walk-in allocation.
- Daily production table and date-specific plan overrides.

The manual reservation form may accept today's pickup date even after online cutoff, but still validates opening days, product weekdays, and capacity.

## 10. Customer UI

Flow: pickup date → eligible catalog → cart → name/phone → confirmation → optional management/cancellation.

- Czech UI (`cs-CZ` date formatting), warm bakery styling, responsive and accessible. API Problem Details stay in English; the UI maps error `code`s to Czech copy.
- Revalidate cart on date changes without silently modifying it.
- Disable submission while pending; preserve idempotency key when retrying an unchanged payload, generate a new key when intentionally changing payload.
- Show actionable errors for unavailable quantities and cutoff expiration.
- Management link remains usable after page refresh.

### 10.1 Storefront caching

Caching only speeds up what the storefront displays; it never affects reservation or capacity checks, which always read the database inside the transaction.

- **URLs:** `/` asks for a pickup date; each date is a path segment, `/den/YYYY-MM-DD`. A path segment (not `?date=`) is required for instant switching: Next 16 reuses the page segment when only search params change and then waits for the server instead of rendering the `<Link prefetch>` payload.
- **Cached:** the products offered on a date (name, description, image), via `'use cache'` with `cacheLife('minutes')` and tag `catalog`. They do not depend on the current time. Date links use `prefetch`, so switching dates renders from the prefetched cache without a server round trip.
- **Never cached:** anything that depends on the current time or on reservations — the pickup-date list (booking window, cutoff), the selected date's bookability, and remaining availability — and product prices, so the catalog and cart never show a price that differs from the one charged. These render per request behind `<Suspense>` after `connection()`; each product card streams its price and remaining quantity into a slot of the cached card, from one per-request query set shared by all cards and the cart summary, so the cart never shows a price or availability other than the one displayed. If that load fails, only the slots show an error.
- The catalog renders only for dates in a cached list of bookable dates (5-minute expiry), which keeps it prefetchable and bounds its cache; the uncached status warning and the reservation transaction remain authoritative.
- The pickup-date picker lives in a layout shared by `/` and `/den/[date]`, so the date list loads once per visit.
- Admin mutations to products, product weekdays, opening days, or closures must invalidate the `catalog` tag. Until they do, displayed names, descriptions and images may be stale for minutes, and a withdrawn product's card says it can no longer be reserved.

## 11. Security and operational requirements

- Zod validation at all external boundaries.
- Server-authoritative pricing, capacity, and permissions.
- Parameterized SQL via Drizzle.
- Strong secrets, Argon2id password hashes, HTTPS.
- Rate limiting for login and public reservation creation using the PostgreSQL `rate_limits` table (§5.6.1); no in-memory limiter, because serverless instances do not share memory. Starting limits: `POST /api/reservations` 10 per IP per 10 minutes; login 5 per IP+email per 15 minutes. Idempotent replays count toward the limit. The rate-limit check runs outside the reservation transaction.
- Do not log passwords, management tokens, or idempotency keys.
- Prevent reservation enumeration and public exposure of phone numbers.
- Avoid caching private reservation responses.
- Never expose database credentials to the browser.
- Admin sessions must be checked server-side for every mutation.

## 12. Date/time implementation

Use `Europe/Prague` consistently for business rules. Pickup dates are PostgreSQL `DATE`; events are `TIMESTAMPTZ`.

Compute cutoff by taking the pickup date in the Prague calendar, moving to the **preceding calendar date**, constructing **18:00 local time**, and converting to an instant. **Do not subtract a fixed 24 hours from a UTC timestamp.** Test daylight-saving transitions and the exact 18:00 boundary. Make the clock injectable/testable.

## 13. Testing strategy

### Unit — Vitest

- Availability and production calculations.
- Cutoff before/at/after 18:00.
- Online and admin booking-window boundaries.
- Online quantity limits and phone normalization.
- Daylight-saving transitions.
- Date/product eligibility.
- Reservation state transitions.
- Zod schemas.

### Integration — Vitest + isolated real PostgreSQL

1. Successful multi-product reservation.
2. Insufficient capacity rejects entire cart.
3. Two concurrent reservations for the final unit.
4. Overlapping multi-product concurrent reservations.
5. Same idempotency key + same payload returns original confirmation/link.
6. Same idempotency key + different payload returns conflict.
7. Early cancellation releases capacity.
8. Customer cancellation at cutoff is rejected.
9. Admin late cancellation retains production commitment.
10. Admin reservation after cutoff succeeds if capacity remains.
11. Admin reservation after cutoff fails when over capacity.
12. Admin reservation for past date is rejected.
13. Reservation creation concurrent with capacity reduction.
14. Cancellation concurrent with new reservation.
15. Conflicting concurrent status updates.
16. First-write daily-plan snapshot behavior.

Concurrency tests must use **independent database connections and deliberate synchronization**, not just `Promise.allSettled`. Assert both returned results and final database state.

### E2E — Playwright

One primary customer journey: select eligible date → add products → enter details → submit → confirm → open management URL → cancel before cutoff → verify cancelled state. Use deterministic seeded data.

## 14. Local development and production

### Local

PostgreSQL in Docker Compose. Provide Drizzle migrations, seed script, README, `.env.example`, and scripts for dev, typecheck, lint, test, integration test, E2E, build, migrate, and seed.

```dotenv
DATABASE_URL=            # pooled connection for runtime
DATABASE_URL_UNPOOLED=   # direct connection for migrations, if required
AUTH_SECRET=
MANAGEMENT_TOKEN_SECRET=
APP_URL=                 # canonical origin for customer links; empty locally = request origin
ADMIN_SEED_EMAIL=
ADMIN_SEED_PASSWORD=
```

Never commit real secrets.

### Production

- Netlify for Next.js; Neon for PostgreSQL.
- Deploy an early spike that verifies, in a deployed Netlify Function: interactive transactions and `SELECT ... FOR UPDATE` through Neon's pooled connection, a minimal concurrent locking test, and Argon2id hash/verify (§2.1, §2.2).
- Configure environment variables and run migrations explicitly.
- Set `APP_URL` to the production URL in every deploy context. Deploy Previews share the production database, so management links must not point at the preview host.
- Seed demo admin and catalog; do not run destructive seed automatically on every deployment.
- Verify authentication, reservation creation, and concurrency behavior in the deployed environment.
- Deliver public URL, admin URL, and demo credentials.

## 15. Definition of done

- Customers can reserve multiple products and receive a valid management link.
- Concurrent requests cannot oversell the final unit.
- Retries do not create duplicate reservations.
- Customer cancellation works before cutoff and is blocked afterward.
- Admin can authenticate, manage products, view reservations, create phone orders, update statuses, and edit daily plans.
- Admin can book after online cutoff **without exceeding capacity**.
- Early cancellations release capacity; late cancellations remain committed to production.
- Production figures are correct.
- Unit and integration tests pass; one Playwright customer flow passes.
- Netlify/Neon deployment is functional and reviewers have credentials.

## 16. Deliberate tradeoffs

No customer accounts, payments, notifications, time slots, reservation editing, multi-location, advanced analytics, background queues, separate backend, Payload CMS, or extensive E2E suite. Invest engineering effort in transactional correctness and a clear demonstration of the core business workflow.

## 17. Instructions for Claude Code

The working process and invariants for Claude Code are defined in `CLAUDE.md` at the repository root.

**Most important acceptance criterion:** Two concurrent requests competing for the final available unit must never both succeed.
