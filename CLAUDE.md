# BakeryOS — Claude Code Instructions

## Project overview

BakeryOS is a full-stack application for managing bakery reservations and daily production planning.

This is a time-constrained take-home assignment. Prioritize correctness, simplicity, maintainability, and a working demo over unnecessary abstractions or additional features.

## Project documentation

Read the relevant documentation before making changes:

- `docs/PRD.md` — Product requirements and business rules.
- `docs/TDD.md` — Technical architecture, database design, and implementation decisions.
- `docs/IMPLEMENTATION_PLAN.md` — Implementation stages and acceptance criteria.

**Source of truth:**

1. PRD defines what the product must do.
2. TDD defines how the system should work.
3. Implementation plan defines the order of delivery.

If documents conflict, identify the inconsistency and ask for clarification rather than silently choosing an interpretation.

Do not modify these documents without explicit approval.

## Technology stack

- Next.js App Router
- React and TypeScript (strict mode)
- Tailwind CSS
- PostgreSQL and Drizzle ORM
- Zod
- Auth.js with Credentials provider
- Vitest and Playwright
- Netlify and Neon PostgreSQL

Do not introduce additional frameworks, services, or major dependencies without explaining the need and obtaining approval.

The installed Next.js version may differ from your training data. Before writing Next.js code, consult the version-matched docs in `node_modules/next/dist/docs/` and heed deprecation notices.

## Working process

### Before implementation

1. Read the relevant documentation and existing code.
2. Identify the current implementation stage.
3. Present a concise implementation plan.
4. Highlight ambiguities, risks, and potential deviations.
5. Ask questions only when decisions materially affect correctness, scope, or architecture.

### During implementation

- Work on one implementation stage at a time.
- Do all work in feature branches (e.g. `stage-1/health-endpoint`), never directly on `main`. Merge to `main` only with approval.
- Make small, focused changes.
- Follow existing project conventions.
- Prefer simple functions and explicit types.
- Avoid speculative abstractions.
- Keep business logic out of React components and route handlers.
- Do not implement deferred features unless explicitly requested.
- Do not proceed to the next stage without approval.

### After implementation

1. Run relevant tests and checks.
2. Review the diff for unintended changes.
3. Summarize what was implemented.
4. List any deviations from the specification.
5. Report test results and remaining risks.
6. Mark completed tasks as checked (`- [x]`) in `docs/IMPLEMENTATION_PLAN.md`.
7. Check whether the stage changed or verified anything the docs should record
   (decisions, deviations, setup or deployment steps). Update `README.md` directly;
   propose changes to `docs/PRD.md` or `docs/TDD.md` and apply them only after approval.
8. Wait for approval before proceeding.

Never claim a test passed unless it was actually executed successfully.

## Critical business invariants

The following rules must never be violated:

1. Product/date capacity must never be oversold.
2. Capacity-affecting writes must use PostgreSQL transactions and consistent row-level locking.
3. Multi-product reservations must be atomic.
4. Every reservation, online or phone, must respect the previous-day 18:00 cutoff in `Europe/Prague`.
5. Administrators may cancel after the cutoff and edit today's daily plan, but never bypass capacity constraints.
6. Early cancellations release capacity.
7. Late cancellations, by customers or administrators, retain production commitments.
8. Reservation creation must be idempotent.
9. Product prices must be read from the database.
10. Historical reservation item snapshots must remain unchanged.

Never replace database locking with in-memory locks or client-side availability checks.

## Architecture guidelines

- Use Server Components for server-side reads.
- Use Server Actions for administrative mutations.
- Use Route Handlers for the public reservation API.
- Keep application services independent of transport concerns.
- Prefer pure functions for domain calculations.
- Validate external inputs using Zod.
- Use typed domain errors.
- Keep database access on the server.
- Reuse application services across public and admin workflows.

Do not introduce Payload CMS, a separate backend, or a generic repository framework.

## Code quality

- Use TypeScript strict mode.
- Avoid `any` unless justified.
- Prefer readable code over clever abstractions.
- Use descriptive names.
- Handle errors explicitly.
- Avoid unnecessary comments that repeat the code.
- Do not suppress TypeScript or lint errors without justification.
- Keep dependencies minimal.

## Testing

Use Vitest for unit and integration tests and Playwright for E2E tests.

Prioritize tests for:

- Reservation concurrency.
- Capacity calculations.
- Idempotency.
- Cancellation rules.
- Date/time boundaries.
- Reservation state transitions.

Integration tests must use real PostgreSQL.

For concurrency tests, verify the final database state, not just returned results.

Run relevant tests after changes and report failures clearly.

## Security

- Never commit secrets or credentials.
- Never log management tokens or passwords.
- Validate authorization on the server.
- Never trust client-provided prices, permissions, or availability.
- Avoid exposing sensitive customer information.
- Do not bypass security checks for convenience.

## Scope management

The goal is a complete, reliable P0 MVP.

When time is limited, prioritize:

1. Correct reservation and capacity logic.
2. Complete customer reservation flow.
3. Essential administrative workflows.
4. Tests and production deployment.
5. Visual polish.

Do not sacrifice business correctness to implement optional features.

## Communication

Be concise, direct, and technically precise.

Explain important architectural decisions and tradeoffs.

If an approach is unsafe, unnecessarily complex, or inconsistent with the specification, say so.

Do not silently make major architectural decisions.

**At the end of each implementation stage, stop and wait for approval.**