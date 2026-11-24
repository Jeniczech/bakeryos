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

The seed is safe to re-run: it upserts the opening days and administrator (resetting the admin password from `ADMIN_SEED_PASSWORD`, min. 12 characters), adds missing closures, and inserts the demo catalog only when the `products` table is empty.

`GET /api/health` returns `{"status":"ok","database":"ok"}` when the database is reachable, `503` otherwise.

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
- Netlify environment variables: `DATABASE_URL` (Neon **pooled** connection string), `DATABASE_URL_UNPOOLED` (direct connection, used for migrations), `NODE_VERSION=24`.

### Migrations

Migrations are applied explicitly, never automatically during builds.

1. Put the Neon connection strings in `.env.neon` (git-ignored; same keys as `.env`).
   It is deliberately not named `.env.production.local`, because `next build`/`next start` would load that file locally and connect to production.
2. Run `pnpm db:migrate:prod`. It fails if `.env.neon` is missing instead of falling back to the local database.
3. Push the code to `main`.

Keep migrations backward compatible so the currently deployed version keeps working until the new deploy is live.
