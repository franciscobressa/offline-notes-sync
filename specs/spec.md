# Spec: note sync

Source: Case 05 of the technical challenge catalog. Each test references the ID of the rule (`R`),
assumption (`A`) or scenario (`S`, `C`) it protects ([ADR 0012](../docs/adr/0012-testing-strategy.md)).

## Rules (from the brief)

| ID | Rule |
|---|---|
| R1 | The server starts with no notes. A note has `id`, `text` and `revision`. |
| R2 | With `baseRevision = 0` and no existing note, the note is created at revision 1. |
| R3 | With `baseRevision` equal to the current revision, the text is replaced and the revision goes up by 1, **even if the text is the same**. |
| R4 | If the base does not match, the result is `conflict`, with the server's current state (or the fact that the note does not exist) and the client's proposal. No automatic merge and no clock. |
| R5 | Fields are validated first. An invalid operation **does not take** the `opId`. |
| R6 | The first valid operation with an `opId` has its content and result stored, including on conflict. |
| R7 | The same `opId` with the same content returns the original result, without applying it again. |
| R8 | The same `opId` with different content results in `id_reused`. |
| R9 | The batch is processed in order, with one result per operation. An error or conflict does not stop the following ones. |
| R10 | A separate query shows the note's current state. A replayed receipt may carry old data. |
| R11 | A conflict is resolved with a new operation: new `opId`, current base and the chosen text. |

## Assumptions (gaps in the brief)

The brief leaves these points open. This is the decision for each one.

| ID | Assumption | Details |
|---|---|---|
| A1 | "Same content" is exact equality of `noteId`, `baseRevision` and `text`, with no normalization. | [ADR 0007](../docs/adr/0007-idempotency-by-op-id.md) |
| A2 | Ids are strings of 1 to 128 characters. `baseRevision` is an integer from 0 to `Number.MAX_SAFE_INTEGER`. `text` is a string of up to 100,000 characters, **empty allowed**. Unknown fields are dropped. | [ADR 0008](../docs/adr/0008-data-contract.md) |
| A3 | `baseRevision = 0` for a note that **already exists** results in `conflict` with the current state, not a validation error. | R4 |
| A4 | `baseRevision > 0` for a **missing** note results in `conflict` with `server: null`. | R4 |
| A5 | An `opId` repeated **within the same batch** is treated as a resend, because the first occurrence is already stored when the second is processed. | R7, R9 |
| A6 | An invalid operation whose `opId` matches a used one results in `invalid`, because validation comes before the receipt lookup. | R5 |
| A7 | Identical text on a stale base **is** a conflict. | [ADR 0010](../docs/adr/0010-conflict-on-identical-text.md) |
| A8 | `id_reused` is not stored. A later resend with the **original** content still returns the original receipt. | R7, R8 |
| A9 | A resend returns the identical receipt, plus `replayed: true`. | [ADR 0008](../docs/adr/0008-data-contract.md) |

## Acceptance scenarios

Format: **Given** (initial state) / **When** (what arrives) / **Then** (result and final state).
Operations are written as `{ opId, noteId, baseRevision, text }`.

### S1. The brief's scenario (R2, R3, R4, R7, R8, R10, R11)

Given an empty server, process in sequence:

| Step | When | Then | State of N |
|---|---|---|---|
| 1 | `{ O1, N, 0, "initial" }` | `created` | rev 1, "initial" |
| 2 | `{ O2, N, 1, "edit A" }` | `updated` | rev 2, "edit A" |
| 3 | `{ O3, N, 1, "edit B" }` | `conflict`: `server` rev 2 "edit A", `proposal` base 1 "edit B" | rev 2, "edit A" |
| 4 | `{ O2, N, 1, "edit A" }` (resend) | the receipt from step 2 + `replayed: true` | rev 2, "edit A" |
| 5 | `{ O4, N, 2, "A + B" }` | `updated` | rev 3, "A + B" |
| 6 | `{ O3, N, 1, "edit B" }` (resend) | the receipt from step 3 (**rev 2**) + `replayed: true` | rev 3, "A + B" |
| 7 | query N | rev 3, "A + B" | — |
| 8 | `{ O2, N, 1, "other text" }` | `id_reused` | rev 3, "A + B" |

### Create and update

**S2. Create a note (R2)**

- Given an empty server
- When `{ O1, N, 0, "a" }` arrives
- Then `created`, and N is at rev 1 with "a"

**S3. Same text on the right base still bumps the revision (R3)**

- Given N at rev 1 with "a"
- When `{ O2, N, 1, "a" }` arrives
- Then `updated`, and N goes to rev 2 with "a"

**S4. Empty text is a valid edit (A2)**

- Given N at rev 1 with "a"
- When `{ O2, N, 1, "" }` arrives
- Then `updated`, and N goes to rev 2 with ""

### Conflicts

**S5. Stale base (R4)**

- Given N at rev 2 with "x"
- When `{ O3, N, 1, "y" }` arrives
- Then `conflict` with `server` rev 2 "x" and `proposal` base 1 "y", and N does not change

**S6. Base > 0 for a missing note (A4)**

- Given an empty server
- When `{ O1, N, 3, "a" }` arrives
- Then `conflict` with `server: null`, and no note is created

**S7. Base 0 for an existing note (A3)**

- Given N at rev 1 with "a"
- When `{ O2, N, 0, "b" }` arrives
- Then `conflict` with `server` rev 1 "a", and N does not change

**S8. Identical text on a stale base (A7)**

- Given N at rev 2 with "x"
- When `{ O3, N, 1, "x" }` arrives
- Then `conflict`, and N does not change

**S22. Base ahead of the server (R4)**

- Given N at rev 2 with "x"
- When `{ O3, N, 5, "y" }` arrives
- Then `conflict`, and N does not change. The rule is "different base", not "lower base"

**S9. Resolving a conflict (R11)**

- Given N at rev 2 with "x" and O3 refused with a conflict
- When `{ O4, N, 2, "x + y" }` arrives
- Then `updated`, and N goes to rev 3 with "x + y"

### Validation

**S10. An invalid operation does not take the `opId` (R5)**

- Given an empty server
- When `{ X, N, -1, "a" }` and then `{ X, N, 0, "a" }` arrive
- Then the first is `invalid` and the second is `created`

**S11. Invalid with a used `opId` stays `invalid` (A6)**

- Given O1 already processed
- When `{ O1, N, -1, "a" }` arrives
- Then `invalid` (not `id_reused` nor a replay)

**S12. Invalid inputs (A2)**: each row results in `invalid`, and nothing is stored.

| Input | Reason |
|---|---|
| no `opId`, or `opId: ""` | id required and not empty |
| `opId` with 129 characters | over the limit |
| no `noteId`, or `noteId: 42` | id required, of type string |
| `baseRevision: -1` | negative |
| `baseRevision: 1.5` | not an integer |
| `baseRevision: "1"` | not a number |
| `baseRevision` above `Number.MAX_SAFE_INTEGER` | integer not safely representable |
| no `text`, or `text: null` | text required, of type string |
| `text` with 100,001 characters | over the limit |
| `null`, a number or a list instead of the operation | not an object |

**S13. An unknown field is ignored (A2)**

- Given an empty server
- When `{ O1, N, 0, "a", extra: true }` arrives
- Then `created`. A resend **without** `extra` is the same content and gets a replay, not `id_reused`

### Idempotency

**S14. Resending a success (R7, A9)**

- Given O2 applied, with N at rev 2
- When O2 arrives again, identical
- Then the original receipt + `replayed: true`, and N stays at rev 2

**S15. Resending a conflict after the note changed (R7, R10)**

- Given O3 refused with a conflict while N was at rev 2, and N later moved to rev 3
- When O3 arrives again
- Then the original receipt, showing **rev 2**, + `replayed: true`. Querying N shows rev 3

**S16. `opId` reused with different content (R8, A8)**

- Given O2 applied with "a"
- When O2 arrives with "b", and then O2 with "a"
- Then the first gets `id_reused` and the second gets the original receipt + `replayed: true`

**S17. "Same content" is exact (A1)**

- Given O2 applied with "a"
- When O2 arrives with "a " (one extra space)
- Then `id_reused`

### Batch

**S18. Order and independence (R9)**

- Given N at rev 1 with "a"
- When the batch `[ invalid, { O2, N, 1, "b" }, { O3, N, 1, "c" }, { O4, N, 2, "d" } ]` arrives
- Then 4 results, in order: `invalid`, `updated`, `conflict`, `updated`. N ends at rev 3 with "d"

**S19. `opId` repeated in the same batch (A5)**

- Given an empty server
- When the batch `[ { O1, N, 0, "a" }, { O1, N, 0, "a" } ]` arrives
- Then `created`, and then the same receipt + `replayed: true`

**S20. Empty batch**

- When `{ operations: [] }` arrives
- Then `{ results: [] }`

### Query

**S21. A query changes nothing (R10)**

- Given N at rev 2
- When N is queried twice, and a missing note is queried too
- Then N looks the same both times, the missing one returns "not found", and nothing is stored

### Concurrency

Simultaneous requests against the in-memory adapter. `async/await` interleaves transactions at every
`await`, so these scenarios fail without the adapter's mutex
([ADR 0009](../docs/adr/0009-in-memory-persistence.md)).

**C1. Simultaneous copies of the same operation (R7)**

- Given N at rev 1
- When 20 copies of `{ O2, N, 1, "b" }` arrive at the same time
- Then exactly 1 `updated` result without `replayed`, 19 with `replayed: true`, and N at **rev 2**

**C2. Different operations on the same base (R4)**

- Given N at rev 1
- When 20 different operations with base 1 arrive at the same time
- Then exactly 1 `updated`, 19 `conflict`, and N at **rev 2** with the winner's text

**C3. Simultaneous creations of the same note (R2)**

- Given an empty server
- When 20 different operations with base 0 for N arrive at the same time
- Then exactly 1 `created`, 19 `conflict`, and N at **rev 1**
