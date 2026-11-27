# BakeryOS — Implementation Plan

**Version:** 1.2  
**Status:** Ready to execute  
**Estimated effort:** Approximately 24–30 focused hours across 3 days  
**Source of truth:** `PRD.md` (product behavior), `TDD.md` (technical design)

## 1. Working agreement with Claude Code

Work in **eight sequential stages**, one at a time, following the per-stage working process in `CLAUDE.md`. Do not silently expand P0 scope.

## 2. Stage overview

| Stage | Deliverable | Estimate |
|---|---|---:|
| 1 | Foundation + deployment spike | 2–4 h |
| 2 | Database + domain rules | 2–3 h |
| 3 | Transactional reservation engine | 5–7 h |
| 4 | Public API + cancellation | 2–3 h |
| 5 | Customer storefront | 3–4 h |
| 6 | Auth.js + admin dashboard | 5–6 h |
| 7 | Integration + E2E verification | 2–3 h |
| 8 | Production polish + handoff | 1–2 h |

The estimates are planning targets, not guarantees. Stage 3 is the critical checkpoint.

## 3. Stage 1 — Foundation and deployment spike

**Goal:** Running project, working database, and early validation of Netlify/Neon compatibility.

### Tasks

- [x] Initialize Next.js App Router, strict TypeScript, and Tailwind CSS.
- [x] Set up PostgreSQL, Drizzle, Drizzle Kit, and Docker Compose.
- [x] Establish basic project folders from the TDD.
- [x] Create `.env.example` and package scripts.
- [x] Add `/api/health` that checks DB connectivity.
- [x] Deploy a minimal version to Netlify connected to Neon.
- [x] Use Neon's **pooled** connection string for runtime connections; keep migrations on a separate (unpooled) connection if the migration tooling requires it.
- [x] Verify the chosen Drizzle driver supports **connection-bound interactive transactions** and `SELECT ... FOR UPDATE` **through the pooler** in the deployed runtime.
- [x] Run a minimal **concurrent** transaction test against Neon via the pooled connection, confirming that row-level locking prevents conflicting updates.
- [x] Verify **Argon2id** hash and verify inside a deployed Netlify Function, not only at build time. Keep Argon2id if compatible; propose an alternative before changing the hashing approach.

### Acceptance criteria

- Local dev server starts.
- Database migration runs successfully.
- Production health endpoint confirms DB connectivity.
- Transaction/row-lock spike, including the concurrent locking test, works through the Neon pooler in the actual deployment environment.
- Argon2id hash/verify works in a deployed function.
- Typecheck, lint, and build pass.

**Stop condition:** Do not proceed with the reservation engine until these deployment assumptions are validated. Report any limitations or required architectural changes before continuing.

## 4. Stage 2 — Database and domain rules

**Goal:** Correct schema, seeds, and testable business rules.

### Tasks

- [x] Implement products, daily plans, reservations, reservation items, admin users, schedule, and `rate_limits` tables.
- [x] Add DB constraints, indexes, the `reservation_number_seq` sequence, and migrations.
- [x] Seed bakery schedule, sample products, and one administrator.
- [x] Implement pure availability and recommended-production functions.
- [x] Implement cutoff calculation in `Europe/Prague`.
- [x] Implement reservation state-transition and date/product eligibility rules, including the booking window (`today+1..today+7`, every source) and the daily-plan planning window (`today..today+7`).
- [x] Implement online quantity limits and phone normalization (Zod).
- [x] Add Vitest unit tests.

### Acceptance criteria

- Seeds produce useful demo data.
- DB rejects invalid capacities, prices, quantities, statuses, and duplicate product/date plans.
- Cutoff tests cover before, exactly at, and after 18:00, including DST boundaries.
- Booking-window, quantity-limit, and phone-normalization tests cover boundaries.
- Domain helpers run without Next.js or DB dependencies.

## 5. Stage 3 — Transactional reservation engine

**Goal:** Safe, idempotent, all-or-nothing reservations.

### Tasks

- [x] Implement first-write daily-plan materialization.
- [x] Implement deterministic multi-product `SELECT ... FOR UPDATE` locking.
- [x] Implement committed-quantity aggregation after locks.
- [x] Implement `createReservation()` with trusted `online`/`admin` source.
- [x] Apply cutoff to every source; never bypass capacity.
- [x] Implement idempotency key, canonical request hash, and unique-conflict replay handling.
- [x] Implement deterministic HMAC management token derivation and stored token hash.
- [x] Implement `updateDailyPlan()` with the same locking protocol.
- [x] Add core PostgreSQL integration tests for concurrency and idempotency.

### Acceptance criteria

- Exactly one of two competing requests can claim the final unit.
- Overlapping multi-product reservations preserve consistency.
- An unavailable item rejects the entire cart.
- Same idempotency key/payload returns the original confirmation and management link.
- Same key/different payload returns conflict.
- Concurrent capacity reduction cannot violate existing commitments.
- Admin bookings follow the same window and cutoff as online and never exceed capacity.

**Mandatory review checkpoint:** Inspect transaction boundaries, lock order, re-reads after locking, and final DB assertions before moving on.

## 6. Stage 4 — Public API and cancellation

**Goal:** Complete public reservation backend.

### Tasks

- [x] Implement `GET /api/products?date=...`.
- [x] Implement `POST /api/reservations` with public source forced to `online`.
- [x] Add PostgreSQL-backed rate limiting to `POST /api/reservations` (`429` + `Retry-After`).
- [x] Implement `GET /api/reservations/manage/:token`.
- [x] Implement `POST /api/reservations/manage/:token/cancel`.
- [x] Add Zod schemas, typed domain errors, and RFC 9457 Problem Details responses.
- [x] Implement transactional `cancelReservation()` using shared daily-plan locks.
- [x] Verify no sensitive management tokens are logged or cached.

### Acceptance criteria

- API creates and retrieves reservations without UI.
- Valid management URL accesses only its reservation.
- Customer cancellation before cutoff releases capacity.
- Customer cancellation at/after cutoff is rejected.
- Admin late cancellation retains production commitment.
- Repeated cancellation has no extra side effects.
- Exceeding the reservation rate limit returns `429`.

## 7. Stage 5 — Customer storefront

**Goal:** Complete mobile-friendly customer flow.

### Tasks

- [x] Build pickup-date selection and eligible catalog.
- [x] Display price and remaining availability.
- [x] Build cart with integer quantities and totals.
- [x] Build customer name/phone form.
- [x] Submit with a stable idempotency key and pending state.
- [x] Build confirmation screen with reservation number and management link.
- [x] Build reservation-management/cancellation screen.
- [x] Add loading, empty, error, and capacity-conflict states.
- [x] Revalidate cart on date changes without silently editing it.

### Acceptance criteria

- Entire customer journey works on mobile and desktop.
- A changed date clearly flags invalid cart contents.
- Capacity and cutoff errors are understandable.
- Double-click/retry cannot create duplicate reservations.
- Management link works after refresh.

## 8. Stage 6 — Auth.js and admin dashboard

**Goal:** Bakery staff can run daily operations.

### Tasks

- [x] Configure Auth.js Credentials with Argon2id and seeded admin.
- [x] Add PostgreSQL-backed rate limiting to login attempts.
- [x] Protect server-side reads and **every** admin Server Action.
- [x] Build reservation list filtered by pickup date.
- [x] Build manual phone reservation form using `createReservation()` with trusted `admin` source.
- [x] Implement picked-up, cancelled, and no-show actions with valid transitions.
- [x] Build product create/edit/deactivate forms.
- [x] Invalidate the `catalog` cache tag on product, weekday, opening-day and closure changes. Only product changes exist so far; the weekday, opening-day and closure editors are deferred.
- [x] Build production table showing active reserved, retained late-cancelled, walk-in, recommended production, and availability.
- [x] Build daily capacity/walk-in override form.

### Acceptance criteria

- Unauthenticated users cannot read or mutate admin data.
- Admin can create a reservation before cutoff while respecting capacity.
- Admin cannot create a reservation after cutoff, for today, or for a past date.
- All admin mutations reuse the same application services and locking rules.
- Late cancellations remain committed to production.
- Product deactivation preserves historical reservations.

## 9. Stage 7 — Integration and E2E verification

**Goal:** Prove the critical business workflows work end-to-end.

### Tasks

- [x] Complete isolated PostgreSQL integration tests.
- [x] Test competing reservations for the last unit using independent DB connections and controlled overlap.
- [x] Test overlapping multi-product requests.
- [x] Test same/different payload idempotency replay.
- [x] Test early/late cancellation and admin cutoff enforcement.
- [x] Test concurrent capacity edits and status changes.
- [x] Test first-write daily-plan snapshots.
- [x] Implement one Playwright customer flow: date → cart → checkout → confirmation → management → cancellation.
- [x] Run typecheck, lint, build, and test suites.

### Acceptance criteria

- Tests are repeatable and deterministic.
- Final database state confirms no overselling.
- One customer E2E flow passes without manual intervention.
- No known P0 regression remains.

## 10. Stage 8 — Production polish and handoff

**Goal:** Reviewer-ready application and concise technical explanation.

### Tasks

- [ ] Apply production migrations explicitly.
- [ ] Seed safe demo catalog and admin credentials.
- [ ] Verify Netlify + Neon deployment.
- [ ] Run production smoke tests for customer booking and admin login.
- [ ] Review responsive UI, accessibility basics, and error handling.
- [ ] Write README: setup, architecture, tests, deployment, assumptions, and tradeoffs.
- [ ] Prepare public URL, admin URL, and demo credentials.
- [ ] Record known limitations and P1 follow-ups.

### Acceptance criteria

- Reviewer can use the app without installation.
- Customer can create a reservation on the public URL.
- Admin can log in and manage reservations/production.
- README explains key engineering decisions and how to run tests.

## 11. If time runs short

**Never cut:** Transactional capacity protection, idempotency, correct cutoff rules, admin authentication, and at least one real PostgreSQL concurrency test.

**Reduce first:** Animations, visual refinements, optional product images, extra filters, print view, advanced reporting, and other P1 items.

If necessary, keep the admin visually minimal but preserve manual reservation creation and production calculations; those directly address the bakery's problem.

## 12. Talking points for the review

Be ready to explain:

- Why daily product plans are locked with PostgreSQL row-level locks.
- Why reservation creation is idempotent.
- Why a late cancellation remains a production commitment.
- Why phone orders follow the same cutoff as online orders (production is planned at the cutoff).
- Why product name/price snapshots are stored on reservation items.
- Why this is a monolith rather than separate services.
- Why a custom admin was chosen instead of Payload CMS.
- Which features were deferred and what would be built next.
