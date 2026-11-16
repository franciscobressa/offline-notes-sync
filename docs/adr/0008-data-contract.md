# 0008. Data contract: Zod at the edge, results as a discriminated union

- Status: Accepted
- Date: 2026-11-12

## Context

Both ends of an operation need a well-defined shape:

- **Input**: R5 says fields are checked **before** any processing, and an invalid operation does not
  take the `opId`. Validation is therefore a **business rule**: it belongs in the core, is tested with
  the other rules and serves both the API and the web app. TypeScript types do not exist at runtime
  ([ADR 0001](0001-stack.md)).
- **Output**: each operation produces exactly one result (R9). Conflict, invalid operation and
  `id_reused` are **expected outcomes** of the protocol, not system failures. The format must serve
  the core, the API and the simulator, and make it impossible to forget a case.

## Decision

### Input: parse, don't validate

- **Zod (v4) schemas live in `core/domain`**. The schema is the single source of both validation
  and type (`z.infer`). After `parseOperation()`, the `Operation` type guarantees the data, so
  `decide()` never sees invalid input.

| Field | Rule | Reason |
|---|---|---|
| `opId` | string, 1 to 128 characters | Fits a UUID with room to spare and limits abuse. |
| `noteId` | string, 1 to 128 characters | Same reason. |
| `baseRevision` | integer, ≥ 0, up to `MAX_SAFE_INTEGER` | 0 means "create". Fractions and negatives make no sense. |
| `text` | string, **empty allowed**, up to 100,000 characters | Deleting all content is a legitimate edit. The limit protects the server. |

- **Unknown fields are dropped**, not rejected. This keeps newer clients compatible (robustness
  principle), and dropped fields do not count when comparing "same content".
- Validation returns **all errors** of an operation at once, not just the first.
- NestJS validates only the **envelope** (`{ operations: [...] }`). Each operation is validated by
  the core, because one invalid operation must not reject the whole batch.

### Output: results as values

```ts
type OperationResult =
  | { opId: string; status: 'created';   note: Note }
  | { opId: string; status: 'updated';   note: Note }
  | { opId: string; status: 'conflict';  server: Note | null; proposal: Proposal } // null = no note
  | { opId: string; status: 'invalid';   errors: ValidationIssue[] }
  | { opId: string; status: 'id_reused' };
```

- Expected outcomes are **returned values**, never exceptions. Exceptions are for infrastructure
  failures and bugs.
- `created` and `updated` are separate so that the UI and metrics can tell them apart.
- Code that handles results uses an exhaustive `switch` with a `never` check, so a new status breaks
  compilation everywhere it must be handled.
- **Replay**: the returned result is the **original receipt, unchanged** (R7), plus
  `replayed: true`. That field is *delivery* metadata, not part of the stored receipt. It serves
  observability and tells the client that nothing was applied again.

## Alternatives considered

- **class-validator + class-transformer**, the NestJS default: decorators require classes and tie
  validation to NestJS. The core must be framework-free and reusable by the web app.
- **Valibot or ArkType**: smaller and faster, but less known. For a reviewer, Zod reads instantly.
- **Hand-written validation**: no dependency, but verbose, and it does not infer types, so type and
  validation must be kept in sync by hand.
- **JSON Schema with Ajv**: better if other languages consumed the contract. Zod v4 can export JSON
  Schema if that ever matters.
- **Reject unknown fields** (`strict`): safer against client typos, but breaks compatibility when the
  client evolves before the server.
- **Exceptions** (`ConflictException` and so on): control flow by exception for something expected.
  They lose the exhaustiveness check and, in a batch, would need a catch per operation to keep
  going.
- **HTTP status per operation** (`409` for conflict): does not work in a batch, which has a single
  status for N operations ([ADR 0004](0004-http-batch-api.md)).
- **A `Result<T, E>` library** (neverthrow and similar): the same outcome as a native discriminated
  union, with one more dependency and vocabulary.
- **A single `applied` status** instead of `created` and `updated`: simpler, but the UI needs to know
  whether the note was born or changed.

## Consequences

- **Positive**: one place defines what a valid operation is, for the core, the API and the web app.
  Errors come out structured for the `invalid` result. The compiler guarantees every outcome is
  handled. The API JSON is the type itself, and the web app consumes the core's type.
- **Negative**:
  - The core has **one runtime dependency** (`zod`), a conscious exception to "no dependencies in
    the core", because it is a library, not a framework.
  - Callers must always inspect `status`. There is no implicit "happy path" as with exceptions.
- **Limits**:
  - The size limits (128 and 100,000) are our assumptions, not requirements of the brief, and are
    recorded in the spec. The batch size is limited separately ([ADR 0004](0004-http-batch-api.md)).
  - A receipt's format is frozen when it is stored. If the type evolves, old receipts keep the old
    format, and reading them would need versioning (for example, a `v` field).
