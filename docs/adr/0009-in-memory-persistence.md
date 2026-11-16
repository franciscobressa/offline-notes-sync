# 0009. In-memory persistence

- Status: Accepted
- Date: 2026-11-12

## Context

The brief allows everything to run in memory and does not require disk storage. Reviewers must be
able to run the solution and the tests with minimal prerequisites. At the same time, the core
guarantees of the problem (atomicity between note and receipt, idempotency and no *lost update*)
must really hold, not only in the sequential case.

## Decision

- The only adapter of the `SyncStore` port is **`InMemorySyncStore`**, with no dependencies
  ([ADR 0002](0002-hexagonal-architecture.md)).
- It provides the same properties a database would:
  - **Isolation**: a mutex built as a promise chain serializes transactions. Node runs on one thread,
    but every `await` hands control back to the event loop, so two transactions could read the same
    revision before either writes.
  - **Atomicity**: writes go to a staging area and are applied only if the transaction finishes
    without an error. An error discards everything (rollback).
  - **Conditional writes**: `insertNote`, `updateNote` (CAS on the revision) and `insertReceipt`
    return `false` when the condition fails, exactly as a database would.
  - **Copies at the boundary**: everything going in and out is cloned, so callers cannot change the
    stored state.
- Concurrency scenarios C1 to C3 run against this adapter and fail if the mutex is removed.

## Alternatives considered

- **PostgreSQL** via Docker: persistence, several API instances and the guarantees from the database
  itself (CAS with `UPDATE ... WHERE revision = $base`, a primary key on `op_id`). Not chosen because
  it requires Docker to review and more code, while the brief does not ask for persistence.
- **SQLite** (a local file): persists without Docker, but the brief does not require disk, and
  SQLite's write concurrency is one connection at a time, which would hide the concurrency
  discussion.
- **Plain maps, with no transaction**: shorter, but exposed to *lost updates* under simultaneous
  requests, with no rollback when something fails halfway.

## Consequences

- **Positive**: reviewing needs only Node. The rules and the concurrency guarantees are tested in
  milliseconds. The port is shaped around the unit of work, so swapping storage does not touch the
  core.
- **Negative**: data is lost when the API restarts. The mutex protects **one instance**: two API
  instances would have separate states.
- **Limits**: to persist and scale horizontally, the next step is a database adapter that passes the
  same contract suite. The intended schema:

  ```sql
  CREATE TABLE notes (
    id        text    PRIMARY KEY,
    text      text    NOT NULL,
    revision  integer NOT NULL CHECK (revision >= 1)
  );

  CREATE TABLE operations (            -- receipts
    op_id          text    PRIMARY KEY,  -- idempotency key (ADR 0007)
    note_id        text    NOT NULL,     -- no FK: a conflict can point to a missing note
    base_revision  integer NOT NULL,
    text           text    NOT NULL,
    result         jsonb   NOT NULL      -- stored once, never updated
  );
  ```

  The CAS would become `UPDATE notes ... WHERE id = $1 AND revision = $expected`, and the inserts
  would use `ON CONFLICT DO NOTHING`. Both return "0 rows" instead of today's `false`, and the retry
  in [ADR 0006](0006-transaction-per-operation.md) would work unchanged.
