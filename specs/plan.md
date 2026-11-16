# Plan: architecture overview

This document shows **how the pieces fit together**. The **why** of each choice is in the
[ADRs](../docs/adr/README.md), and the **business rules** are in the [spec](spec.md).

## Context

```
  ┌──────────────┐      ┌──────────────┐
  │   Device A   │      │   Device B   │     edit offline and build a local queue
  └──────┬───────┘      └──────┬───────┘     of operations (each with its own opId)
         │  POST /sync (batch) │
         └─────────┬───────────┘
                   ▼
          ┌─────────────────────────────┐
          │          Sync API           │   source of truth, in memory:
          │  (InMemorySyncStore)        │   notes + receipts
          └─────────────────────────────┘
```

## Packages and layers

```
┌─ apps/web (Next.js) ─────────────┐     ┌─ apps/api (NestJS) ──────────────────────┐
│ simulator: 2 devices,            │     │  SyncController  (driving adapter)       │
│ local queue, conflict panel      │────▶│        │                                 │
│ (uses only core types)           │HTTP │        ▼                                 │
└──────────────────────────────────┘     └────────┼─────────────────────────────────┘
                                                  │
┌─ packages/core (no framework) ──────────────────▼─────────────────────────────────┐
│  application/   processBatch()  ──uses──▶  SyncStore port                         │
│                      │                          ▲                                 │
│                      │ calls                    │ implements                      │
│                      ▼                          │                                 │
│  domain/        parseOperation(), decide()   adapters/memory/InMemorySyncStore    │
│                 (pure: no I/O, no clock)      (mutex + rollback)                  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Dependency rule: arrows point **inward**. `domain` knows nobody, `application` knows `domain`, and
the apps know the core ([ADR 0002](../docs/adr/0002-hexagonal-architecture.md),
[ADR 0003](../docs/adr/0003-functional-core-imperative-shell.md),
[ADR 0009](../docs/adr/0009-in-memory-persistence.md)).

## Flow of an operation

```
POST /sync { operations: [op1, op2, ...] }
  │
  ├─ invalid envelope? ────────────────────────────────▶ 400 (or 413 above 100)
  │
  └─ for each op, in order (ADR 0006):
       │
       ├─ parseOperation(op) invalid? ──────────────────▶ { status: invalid }   (nothing stored)
       │
       └─ transaction (mutex)
            receipt  = findReceipt(opId)
            note     = findNote(noteId)
            decision = decide(op, receipt, note)          ◀── pure
            │
            ├─ replay ───────────────────────────────────▶ original receipt + replayed
            ├─ id_reused ────────────────────────────────▶ { status: id_reused }
            ├─ create   → insertNote      ─┐
            ├─ update   → updateNote (CAS) ├─ false? roll back and decide again (≤ 3)
            ├─ conflict → (note untouched) │
            └─ insertReceipt ──────────────┘
          commit ────────────────────────────────────────▶ { created | updated | conflict }
```

## Where each guarantee lives

| Guarantee | Mechanism | Where | ADR |
|---|---|---|---|
| Never overwrite someone else's work | CAS: `updateNote(note, expectedRevision)` | port + adapter | [0005](../docs/adr/0005-optimistic-concurrency.md) |
| A resend is not applied again | receipt per `opId`, stored in the same commit as the effect | shell + adapter | [0006](../docs/adr/0006-transaction-per-operation.md), [0007](../docs/adr/0007-idempotency-by-op-id.md) |
| Transactions do not interleave | mutex in the in-memory adapter | `InMemorySyncStore` | [0009](../docs/adr/0009-in-memory-persistence.md) |
| A receipt shows the original data | receipt stored once, never updated | adapter | [0008](../docs/adr/0008-data-contract.md) |
| An invalid operation does not take the `opId` | validation before the transaction opens | `parseOperation()` | [0008](../docs/adr/0008-data-contract.md) |
| An error does not stop the batch | one transaction per operation; results as values | shell | [0006](../docs/adr/0006-transaction-per-operation.md), [0008](../docs/adr/0008-data-contract.md) |
| Batch order | sequential processing | `processBatch()` | [0006](../docs/adr/0006-transaction-per-operation.md) |
| Decisions without a clock | pure `decide()`, no I/O | domain | [0003](../docs/adr/0003-functional-core-imperative-shell.md) |
| Every outcome is handled | discriminated union + exhaustive `switch` | types | [0008](../docs/adr/0008-data-contract.md) |

## How it would evolve

- **Persistence and several instances**: a database adapter implementing `SyncStore`. The core does
  not change. The guarantees move from the mutex to the database: CAS with
  `UPDATE ... WHERE revision = $base` and a primary key on `op_id`
  ([ADR 0005](../docs/adr/0005-optimistic-concurrency.md), [ADR 0007](../docs/adr/0007-idempotency-by-op-id.md),
  [ADR 0009](../docs/adr/0009-in-memory-persistence.md)). The API becomes stateless and scales
  horizontally.
- **Notifying other devices**: after a write, publish a "note changed" event through a
  *Transactional Outbox* to a broker, and push it to devices over WebSocket or SSE. Messaging belongs
  **after** the write, not on the write path: the client needs the decision (`updated` or `conflict`)
  synchronously.
- **Receipt retention**: receipts grow forever. In production they expire with the client's resend
  window.
- **Highly contended notes**: many conflicts on the same note mean "whole note" granularity is too
  coarse. The next step would be per-block editing or CRDTs.
- **Latency of large batches**: process operations on **different notes** in parallel, keeping the
  order within each note.

## Known limits

- **In memory only**: data is lost when the API restarts, and the mutex protects a single instance
  ([ADR 0009](../docs/adr/0009-in-memory-persistence.md)).
- Conflict granularity is the whole note ([ADR 0005](../docs/adr/0005-optimistic-concurrency.md)).
- Without authentication, the `opId` scope is global ([ADR 0007](../docs/adr/0007-idempotency-by-op-id.md)).
- No receipt retention ([ADR 0007](../docs/adr/0007-idempotency-by-op-id.md)).
- Order is only guaranteed within a batch ([ADR 0006](../docs/adr/0006-transaction-per-operation.md)).
- The simulator's queue lives in browser memory, and there is no automatic retry
  ([ADR 0011](../docs/adr/0011-web-client.md)).
- After a lost response, a new offline edit conflicts with the previous one
  ([ADR 0011](../docs/adr/0011-web-client.md)).
