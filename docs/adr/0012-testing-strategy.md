# 0012. Testing strategy and traceability to the spec

- Status: Accepted
- Date: 2026-11-12

## Context

The work is spec-driven: rules R1 to R11 and the acceptance scenarios come before the code. The brief
asks to highlight up to three tests and explain what kind of bug each one catches. The concurrency
guarantees ([ADR 0006](0006-transaction-per-operation.md) and
[ADR 0007](0007-idempotency-by-op-id.md)) must be demonstrated, not just claimed.

## Decision

- **Vitest** across the monorepo, with a single command: `npm test`.
- **Traceability**: each test name starts with the ID of the rule or scenario in the spec, such as
  `[R7] replay returns the original receipt`. Searching for `R7` finds the rule and all its tests.
- **Layers**:

| Layer | What it tests | Against what |
|---|---|---|
| Unit (core) | `parseOperation()` and `decide()` in table tests (`it.each`) | pure functions |
| Application (core) | `processBatch()`: order, one result per operation, an error does not stop the batch, retry | `InMemorySyncStore` and a store that simulates stale reads |
| Contract (core) | what every `SyncStore` adapter must do | `InMemorySyncStore` |
| Concurrency (core) | 20 simultaneous requests: copies of one operation apply once; edits on the same base give one `updated` and the rest `conflict` | `InMemorySyncStore` |
| E2E (api) | the brief's scenario over HTTP, the envelope and status codes | NestJS + memory |
| Client (web) | device queue, coalescing edits, conflict resolution | pure functions |

- **Manual mutation testing** for the main guarantees: break the rule on purpose and confirm that a
  test fails.

## Alternatives considered

- **Jest**, the NestJS default: same API, but slower, with more work for ESM and TypeScript.
- **Repository mocks in rule tests**: unnecessary, because the rule is pure
  ([ADR 0003](0003-functional-core-imperative-shell.md)). Mocks would test the implementation, not
  the behavior.
- **A coverage target**: the brief does not ask for one, and high coverage does not prove the
  concurrency guarantees. The effort goes to scenarios that catch real bugs.

## Consequences

- **Positive**: every test runs in seconds, with no infrastructure. The concurrency guarantees are
  **demonstrated**: without the adapter's mutex, scenarios C1 to C3 fail. Spec and tests are linked
  by IDs.
- **Negative**: the concurrency tests depend on how the event loop interleaves promises. They fire
  every operation at once to maximize interleaving.
- **Limits**: concurrency tests show that the bug **did not show up** in those runs. They are not a
  formal proof. The correctness argument lies in the conditional writes and the mutex
  ([ADR 0006](0006-transaction-per-operation.md), [ADR 0009](0009-in-memory-persistence.md)), and the
  tests confirm it empirically. There is no browser test for the simulator.
