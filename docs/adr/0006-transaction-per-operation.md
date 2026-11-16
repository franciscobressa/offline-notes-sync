# 0006. One transaction per operation, CAS and retry

- Status: Accepted
- Date: 2026-11-12

## Context

Two writes must happen together: applying the change to the note and storing the operation's
receipt. If only the first happens, a resend applies the change again. If only the second happens,
the receipt lies.

The batch cannot be all-or-nothing, because an error or conflict does not stop the next operations
(R9). And several requests can arrive at once: two devices, or the same batch resent after a
timeout.

## Decision

- **One transaction per operation** (a *Unit of Work*), with the batch processed sequentially, in the
  order received.
- Inside each transaction:
  1. `findReceipt(opId)` → `findNote(noteId)` → `decide()`;
  2. apply the decision: `insertNote`, or `updateNote(note, expectedRevision)` (CAS), or nothing for a
     conflict;
  3. `insertReceipt`, which only writes if the `opId` is still free.
- If a conditional write returns `false`, another transaction won the race between the read and the
  write. Then: **roll back, read again and decide again**, up to 3 attempts.
  - The note CAS failed: on the next attempt the revision has changed and the decision becomes
    `conflict`. If the winner was a copy of the same operation, the next attempt finds the receipt
    and replays it.
  - The receipt insert failed: the same `opId` was processed in parallel, and the next attempt finds
    the receipt and replays it.
  - **Why the retry ends**: a revision never decreases and a receipt is never deleted. So every new
    attempt can only end in `conflict` (which stores only the receipt) or in a replay (which stores
    nothing). The worst case is **3 attempts**:
    1. the note CAS fails, because another operation changed the note;
    2. the new decision is `conflict`, but the receipt insert fails, because a copy of the same
       operation stored it first;
    3. the third attempt finds the receipt and replays it, with no write at all.

    The limit of 3 comes from this reasoning. Hitting it means a bug, which produces a `500`.
- The in-memory adapter serializes transactions with a mutex ([ADR 0009](0009-in-memory-persistence.md)),
  so in it the race does not happen. The retry exists because the port **does not assume** full
  isolation: a database adapter under `READ COMMITTED` would lose races, and the application must
  handle that. The path is tested with a store that simulates stale reads.

## Alternatives considered

- **One transaction for the whole batch**: one failure would bring down every operation, or it
  would need a savepoint per operation, which is a transaction per operation with more complexity.
- **Rely only on the mutex, with no conditional writes**: works in memory, but ties correctness to an
  adapter detail. A database with several API instances has no global mutex.
- **Serializable isolation in a future database** (retry on serialization errors): correct, but the
  guarantee becomes **implicit**: the database aborts and the code does not show why. With CAS and a
  unique `opId`, the guarantee is visible in the port and testable.

## Consequences

- **Positive**: atomicity lives in one place (the shell). Since `decide()` is pure
  ([ADR 0003](0003-functional-core-imperative-shell.md)), deciding again is cheap and safe.
- **Negative**: N transactions per batch. The retry loop is one more code path, covered by dedicated
  tests.
- **Limits**: the batch latency is the sum of the operations' latencies. Order is only guaranteed
  **within** a batch, and batches from different clients interleave, which is fine because revisions
  handle it.
