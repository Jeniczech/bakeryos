# BakeryOS

Bakery reservations and daily production planning. Next.js (App Router), PostgreSQL with Drizzle ORM, deployed on Netlify with Neon.

See `docs/PRD.md` (product), `docs/TDD.md` (technical design), and `docs/IMPLEMENTATION_PLAN.md` (delivery stages).

## Requirements

- Node.js 24
- pnpm 10
- Docker (for local PostgreSQL)

## Local setup

```sh
pnpm install
cp .env.example .env       # local defaults point at Docker PostgreSQL
pnpm db:up                 # start PostgreSQL 18 and wait until healthy
pnpm db:migrate            # apply migrations to the local database
pnpm db:seed               # schedule, demo catalog, admin (set ADMIN_SEED_PASSWORD first)
pnpm dev                   # http://localhost:3000
```

Set `MANAGEMENT_TOKEN_SECRET` in `.env` (min. 32 characters, e.g. `openssl rand -base64 32`) before creating reservations or running integration tests: reservation management tokens are derived from it.

Set `AUTH_SECRET` in `.env` (e.g. `openssl rand -base64 32`) before signing in: Auth.js encrypts the admin session cookie with it. The admin signs in at `/admin/login` with `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`.

The seed is safe to re-run: it upserts the opening days and administrator (resetting the admin password from `ADMIN_SEED_PASSWORD`, min. 12 characters), adds missing closures, and inserts the demo catalog only when the `products` table is empty.

`GET /api/health` returns `{"status":"ok","database":"ok"}` when the database is reachable, `503` otherwise.

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
| `test:integration`                            | Integration tests against real PostgreSQL (`tests/integration`)    |
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
