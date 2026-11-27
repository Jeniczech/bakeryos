# BakeryOS

Bakery reservations and daily production planning. Next.js (App Router), PostgreSQL with Drizzle ORM, deployed on Netlify with Neon.

See `docs/PRD.md` (product), `docs/TDD.md` (technical design), and `docs/IMPLEMENTATION_PLAN.md` (delivery stages).

## Demo

| What        | Where                                        |
| ----------- | -------------------------------------------- |
| Storefront  | https://bakeryos-311.netlify.app             |
| Admin login | https://bakeryos-311.netlify.app/admin/login |
| Health      | https://bakeryos-311.netlify.app/api/health  |

Admin credentials are shared with reviewers separately rather than committed, because the repository is public.

The UI is in Czech; API error messages are in English. Pickup dates run from tomorrow to today + 7. Bookings for a date close at 18:00 Prague time the day before, so the first bookable date moves forward after 18:00.

Suggested walkthrough:

1. On the storefront, pick a date, add several products, enter a name and phone number, and submit. Open the management link from the confirmation and cancel.
2. In the admin, open **Rezervace** to see the reservation, create a phone reservation, and cancel or mark one picked up.
3. Open **Výroba** to see the recommended quantity to bake per product, and override a capacity: it can never go below walk-ins plus already committed units.
4. Open **Produkty** to change a price: existing reservations keep the price they were made at.

## Architecture

A single Next.js application, with no separate backend:

- **Route Handlers** (`src/app/api`) serve the public reservation API, which the storefront also uses.
- **Server Components** read data for pages. **Server Actions** run admin mutations and check the session themselves, not only through the layout.
- **Application services** (`src/server/services`) hold the workflows: create and cancel reservations, change status, update daily plans, manage products. They know nothing about HTTP, so the public API and the admin share them; a phone reservation runs the same `createReservation` as an online one, only with `source = 'admin'`.
- **Domain functions** (`src/server/domain`) are pure: availability, production recommendation, cutoff and transition rules. Prague dates and the cutoff live in `src/lib/date-time/prague.ts`.
- **Zod** validates every external input. Services throw typed domain errors, which become RFC 9457 Problem Details in the API and Czech messages in the UI.

### Key decisions

- **Capacity is protected by PostgreSQL row locks, not by checks in application memory.** Every write that affects a product's capacity for a date runs in one transaction. It first creates any missing `daily_product_plans` rows (`INSERT … ON CONFLICT DO NOTHING`), then locks them with `SELECT … FOR UPDATE` in ascending product-ID order so two transactions cannot deadlock. Only after it holds the locks does it re-read committed quantities, eligibility and the clock (waiting for a lock can cross the cutoff), and validate the whole cart. A cart either succeeds completely or nothing is written.
- **Daily plans snapshot product defaults** on their first write, so later changes to a product's default capacity never rewrite a date that already has reservations.
- **Reservation creation is idempotent.** The client sends a UUID key and the server stores a hash of the normalized request. A retry with the same request returns the original confirmation; the same key with a different request is a `409`. A unique constraint is the final guard against concurrent duplicates.
- **Late cancellations stay in production.** Production is planned at the 18:00 cutoff, so an admin cancellation after it keeps `retain_for_production = true` and its units still count as committed. Customers can cancel only before the cutoff, which releases the units.
- **Phone reservations follow the same cutoff** as online ones, for the same reason: units reserved after the plan is made might never be baked. Only the online quantity limits (20 per product, 50 per reservation) do not apply.
- **Prices come from the database** and are stored as integer haléře, with name and price snapshots on each reservation item.
- **A custom admin instead of a CMS:** the admin is a few screens tied closely to the capacity rules, and a CMS such as Payload would add a second data model and its own write path.
- **Management links are bearer tokens** derived with HMAC from `MANAGEMENT_TOKEN_SECRET`, so customers need no account. The database stores only a SHA-256 hash of each token, and a retried request can return the same link because the token is derived again rather than stored.

## Testing

| Command                 | Covers                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`             | Unit tests: availability and production formulas, cutoff and booking window around 18:00 and DST changes, status transitions, validation, HTTP mapping                                                                          |
| `pnpm test:integration` | Services and API against real PostgreSQL: concurrent last-unit bookings (checks the final database state), idempotent replay and races, early vs. late cancellation, daily plan overrides, snapshots, admin auth, rate limiting |
| `pnpm test:e2e`         | Playwright: book, open the management link, cancel                                                                                                                                                                              |

Integration tests (`pnpm test:integration`, with `pnpm db:up` running) never touch the development database. Each run drops and recreates a separate test database and applies the migrations to it: by default the `DATABASE_URL` database with a `_test` suffix (`bakeryos_test`) on the same server, or `TEST_DATABASE_URL` when set. They assume local Docker PostgreSQL: with a Neon `DATABASE_URL` in `.env`, the test database would be created on Neon. Its name must end in `_test`, otherwise the run is refused. Tests create the data they need and need no seed.

The E2E test (`pnpm test:e2e`, with `pnpm db:up` running; once, `pnpm exec playwright install chromium`) books, opens the management link, and cancels in Chromium. Playwright recreates and seeds its own database (`DATABASE_URL` with an `_e2e_test` suffix, or `E2E_DATABASE_URL`), then builds the app and serves it on port 3100 against that database, so development data and a running dev server are untouched. Like the integration tests, it assumes local Docker PostgreSQL: with a Neon `DATABASE_URL` in `.env`, the E2E database would be created on Neon. Its name must end in `_test`. It picks the first bookable date, so it runs at any time of day.

## Requirements

- Node.js 24
- pnpm 10
- Docker (for local PostgreSQL)

## Local setup

```sh
pnpm install
cp .env.example .env       # local defaults point at Docker PostgreSQL
```

Fill in `.env`:

- `MANAGEMENT_TOKEN_SECRET`: min. 32 characters, e.g. `openssl rand -base64 32`. Reservation management tokens are derived from it, so it is needed before creating reservations or running integration tests.
- `AUTH_SECRET`: e.g. `openssl rand -base64 32`. Auth.js encrypts the admin session cookie with it.
- `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD` (min. 12 characters): the administrator the seed creates.

Then:

```sh
pnpm db:up                 # start PostgreSQL 18 and wait until healthy
pnpm db:migrate            # apply migrations to the local database
pnpm db:seed               # schedule, demo catalog, admin
pnpm dev                   # http://localhost:3000
```

`GET /api/health` returns `{"status":"ok","database":"ok"}` when the database is reachable, `503` otherwise.

## Admin

The admin signs in at `/admin/login` with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`. Sessions last 8 hours and are not checked against the database, so resetting the password through the seed does not end existing sessions; rotating `AUTH_SECRET` does.

The seed is safe to re-run: it upserts the opening days and administrator (resetting the admin password from `ADMIN_SEED_PASSWORD`, min. 12 characters), adds missing closures, and inserts the demo catalog only when the `products` table is empty.

Products are managed at `/admin/products`. Unchecking **Aktivní** deactivates a product: it disappears from the catalog and cannot be reserved, while existing reservations keep their name and price snapshots. A new product has no weekday restrictions, so it is offered on every open day (the weekday editor is deferred). Changed default capacity and walk-in quantity apply only to dates without a daily plan yet. Saving a product invalidates the storefront's cached catalog immediately. A save is rejected if the product was changed after the form was loaded (in another tab, by browser back/forward, or by a second admin), so an outdated form never undoes a newer change.

The production view at `/admin/production` lists, per date, the products offered that day plus any product with reservations still counted in production (for example one deactivated since, labelled as such). It shows reserved units, late cancellations (which stay in production), walk-in quantity, the recommended quantity to bake and the remaining availability; dates without a daily plan use the product defaults. Capacity and walk-in quantity can be overridden per product for today through today+7, never below walk-ins plus already committed units. A save is rejected if the plan changed after the row was loaded, so an outdated form never undoes another save. Past dates are read-only and show only stored plans, so later changes to product defaults or the catalog never rewrite history.

## Public API

| Endpoint                                      | Purpose                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/products?date=YYYY-MM-DD`           | Online catalog for a pickup date with prices (haléře) and remaining quantity               |
| `POST /api/reservations`                      | Create a reservation (`201`); same idempotency key and payload replays it (`200`)          |
| `GET /api/reservations/manage/:token`         | Reservation details and whether the customer can still cancel                              |
| `POST /api/reservations/manage/:token/cancel` | Customer cancellation, strictly before 18:00 Prague time the day before pickup; repeatable |

Request body for `POST /api/reservations` (TDD §8); any `source` or price fields are ignored:

```json
{
    "idempotencyKey": "d6c7c4a8-61e2-4a41-89c7-4d3f61b3a825",
    "pickupDate": "2026-11-27",
    "customer": { "name": "Jane Doe", "phone": "+420777123456" },
    "items": [{ "productId": "<product uuid>", "quantity": 2 }]
}
```

Errors are RFC 9457 Problem Details (`application/problem+json`) with a stable `code`, e.g. `INSUFFICIENT_CAPACITY` (409, with a `shortages` array), `CUTOFF_PASSED` (409), `IDEMPOTENCY_CONFLICT` (409), `RESERVATION_NOT_FOUND` (404), `RATE_LIMITED` (429 with `Retry-After`). Reservation creation is limited to 10 requests per client IP per 10 minutes, counted in the `rate_limits` table. On Netlify the client IP comes from `x-nf-client-connection-ip`, which Netlify sets itself. Elsewhere the last `x-forwarded-for` entry is used, which is only trustworthy behind exactly one proxy that appends it. Requests with neither header share a single `unknown` bucket.

Management links (`/reservations/manage/:token`) are built from `APP_URL` when it is set, otherwise from the request's origin. They are bearer credentials. The application never logs them and all reservation responses are sent with `Cache-Control: no-store`, but the token is part of the URL path, so request logs outside the application (the Next.js dev server, hosting access logs) can contain it. The management page is rendered per request, marked `noindex`, and sets `referrer: no-referrer` so the token does not leak to other sites.

## Scripts

| Script                                        | Purpose                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `dev`, `build`, `start`                       | Next.js                                                            |
| `lint`, `typecheck`, `format`, `format:check` | Code quality                                                       |
| `test`                                        | Unit tests (`tests/unit`)                                          |
| `test:integration`                            | Integration tests against an isolated PostgreSQL database          |
| `test:e2e`                                    | Playwright customer flow against a seeded E2E database             |
| `db:up`, `db:down`                            | Start/stop local PostgreSQL                                        |
| `db:generate`                                 | Generate a migration from `src/server/db/schema.ts`                |
| `db:migrate`                                  | Apply migrations to the database in `.env`                         |
| `db:migrate:prod`                             | Apply migrations to Neon using `.env.neon`                         |
| `db:seed`                                     | Seed schedule, demo catalog, and admin into the database in `.env` |
| `db:seed:prod`                                | Seed Neon using `.env.neon`                                        |
| `db:studio`                                   | Drizzle Studio                                                     |

## Production (Netlify + Neon)

- The GitHub repository is linked to Netlify: pushing to `main` deploys production; pull requests get Deploy Previews.
- **Deploy only through Git.** Do not run `netlify deploy` from a local machine: it bundles local `.env*` files into the function and the host's native binary of `@node-rs/argon2`, which fails on Netlify's Linux runtime.
- Netlify environment variables: `DATABASE_URL` (Neon **pooled** connection string), `DATABASE_URL_UNPOOLED` (direct connection, used for migrations), `MANAGEMENT_TOKEN_SECRET` (min. 32 characters; keep it stable across deploys, because changing it invalidates every existing management link), `AUTH_SECRET` (all contexts; changing it signs every administrator out), `APP_URL=https://bakeryos-311.netlify.app` (all contexts: Deploy Previews share the production database, so their management links must also point at production), `NODE_VERSION=24`.
- `AUTH_TRUST_HOST` is not needed: Auth.js trusts the Host header only on platforms it recognizes, which do not include Netlify, so the app sets `trustHost: true` in its Auth.js config.

### Migrations

Migrations are applied explicitly, never automatically during builds.

1. Put the Neon connection strings in `.env.neon` (git-ignored; same keys as `.env`).
   It is deliberately not named `.env.production.local`, because `next build`/`next start` would load that file locally and connect to production.
2. Run `pnpm db:migrate:prod`. It fails if `.env.neon` is missing instead of falling back to the local database.
3. Push the code to `main`.

Keep migrations backward compatible so the currently deployed version keeps working until the new deploy is live.

## Assumptions and tradeoffs

- One bakery, one administrator account, one timezone (`Europe/Prague`).
- Opening days, closures and product weekdays are seeded. They have no admin screens yet (P1).
- Reservations cannot be edited: cancel and create a new one. Statuses `picked_up`, `no_show` and `cancelled` are final.
- Availability shown in the catalog is informational. The server checks it again when the reservation is submitted.
- Rate limiting is stored in PostgreSQL rather than a separate service such as Redis. That is enough for one instance of a small bakery's traffic.
- Admin sessions are stateless JWTs that last 8 hours, so resetting the password does not end existing sessions.
- Deploy Previews share the production database.

## Known limitations and P1 follow-ups

- Admin screens for opening days, closures and product weekdays (new products are offered on every open day).
- A print-friendly production sheet.
- Search and filters in the reservation list, and reporting.
- Product image upload (products support an optional image URL only).
- Rotation of the management-token secret: changing `MANAGEMENT_TOKEN_SECRET` today invalidates every existing management link.
- No email or SMS confirmation. The management link is shown only on the confirmation page, so a customer who loses it has to call the bakery.
- No E2E test for the admin: the Playwright test covers the customer flow, and integration tests cover the admin workflows.
