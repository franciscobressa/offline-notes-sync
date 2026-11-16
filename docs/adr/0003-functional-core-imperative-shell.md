# 0003. Functional Core, Imperative Shell

- Status: Accepted
- Date: 2026-11-12

## Context

The core rule of the brief is a decision: given an operation, the receipt that may already exist for
it and the current state of the note, what is the outcome? Create, update, conflict, replay or
`id_reused`.

Three requirements weigh on this choice:

- **Testability**: eleven rules (R1 to R11) with edge cases, in a spec-driven flow. Each rule must
  map to a direct test.
- **The rule cannot depend on storage**: in memory today, a database tomorrow, always the same rule.
- **R4 forbids using a clock** to decide conflicts.

## Decision

The code follows **Functional Core, Imperative Shell** (Gary Bernhardt, *Boundaries*, 2012):

- **Functional core**: pure functions, with no I/O, no mutation and no clock access.

  ```ts
  parseOperation(input: unknown): ParseResult            // R5: validation
  decide(op: Operation, receipt: Receipt | null, note: Note | null): Decision
  ```

  `Decision` says what to do (create, update with an expected revision, record a conflict, return
  the receipt, refuse as `id_reused`) and which result to return. It does not execute anything.

- **Imperative shell**: the application service opens the transaction, loads the receipt and the
  note, calls `decide()` and applies the decision through the persistence port. It reads like a
  regular *transaction script*, except that the decision was extracted into the core.

This is independent from the hexagonal architecture ([ADR 0002](0002-hexagonal-architecture.md)).
The hexagon separates the core from the outside world. The functional core separates, inside the
core, deciding from executing.

## Alternatives considered

- **Plain transaction script** (all logic in the service, mixed with storage calls): the most common
  style in NestJS, and real sync engines follow it (Replicache's push endpoint, Stripe's idempotency
  keys). Rejected because it ties the rule to the storage driver: the rule could only be tested with
  a database or mocks.
- **Rich entity / DDD** (`note.applyEdit(op)`, aggregates, domain events): the rule would be split,
  because "does the receipt exist?" and "the note does not exist" do not fit a method on the note.
  A self-mutating entity would also have to be undone when the CAS fails. Aggregates and events are
  too much ceremony for a domain with a single central decision.

## Consequences

- **Positive**:
  - Each rule R2 to R8 becomes a row in a table test over `decide()`, with no mocks and no database.
  - R4 holds by construction: `decide()` receives no clock and has no way to read one.
  - Since `decide()` is pure, running it again is safe. This enables the retry in
    [ADR 0006](0006-transaction-per-operation.md) with no risk of a duplicated effect.
- **Negative**:
  - There is an intermediate type (`Decision`) between deciding and executing, an indirection a
    transaction script would not have.
  - People used to the "everything in the service" NestJS shape need to understand the split.
- **Limits**: if the domain grows (deletion, permissions, sharing), `decide()` becomes a large
  function with many branches. That is the time to split it into smaller decisions per operation
  type, or to move to a richer domain model.
