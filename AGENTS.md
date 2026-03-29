# Gmail RL Delivery

## Purpose

This delivery implements a stateful reinforcement-learning environment that reproduces core Gmail workflows: browsing an inbox, reading a thread, drafting a message, sending mail, starring, archiving, marking unread, applying labels, resetting the environment, and restoring prior snapshots.

## Repository Layout

- `package.json`: local scripts for running, testing, syntax validation, and deterministic local proof generation
- `src/server.mjs`: HTTP server and API implementation
- `src/state-store.mjs`: persisted state, snapshotting, restore, and reset logic
- `public/`: Gmail-like browser UI assets
- `openapi/gmail-rl.openapi.yaml`: source-of-truth API contract
- `data/fixtures/initial-state.json`: deterministic seeded environment state
- `scripts/local-validation.mjs`: scripted local validation flow that writes proof artifacts
- `tests/`: automated API and smoke tests
- `artifacts/proof/`: generated local validation proof files
- `vercel.json`: deployment entrypoint for Vercel

## Local Commands

- `cd deliveries/gmail-rl-6`
- `pnpm start`: launch the local environment server
- `pnpm test`: run automated tests
- `pnpm typecheck`: syntax-check the shipped JavaScript files
- `pnpm validate:local`: run a scripted end-to-end validation flow and write proof artifacts

## OpenAPI Ownership

The API surface is defined in `openapi/gmail-rl.openapi.yaml`. Any API change must be made there and kept aligned with the implementation in `src/server.mjs`.

## Restore and Reset Semantics

- Stateful data persists in `data/runtime/state.json`.
- On Vercel, mutable runtime state is stored in the function tmp directory so interactive flows remain writable after deployment.
- Every meaningful mutation creates a new immutable snapshot with a reason string and timestamp.
- `POST /api/reset` resets the environment to the deterministic fixture in `data/fixtures/initial-state.json` and records a reset snapshot.
- `POST /api/snapshots/:snapshotId/restore` restores the exact saved state for that snapshot and records a follow-up restore snapshot.

## Evidence Required Before Updating or Opening a PR

- `pnpm test` output
- `pnpm typecheck` output
- `pnpm validate:local` output plus the generated proof artifact paths
- A local UI verification screenshot or recording showing the Gmail-like workflow running
- The deployment URL and the exact launch commands used locally
