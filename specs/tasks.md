# Tasks

Each phase ends at a **checkpoint**: green tests, review and commit. IDs in brackets link a task to
the spec (`S`, `C`) or to an ADR.

## Phase 1. Decisions and spec

- [x] T1. ADRs
- [x] T2. Spec: rules, assumptions and acceptance scenarios

**✅ Checkpoint 1**: ADRs and spec reviewed.

## Phase 2. Core

- [x] T3. Monorepo: npm workspaces, TypeScript and Vitest [ADR 0001]
- [x] T4. Domain types [ADR 0008]
- [x] T5. `parseOperation()` and tests [S4, S12, S13]
- [x] T6. `decide()` and tests [S2–S8, S14–S17, S22]
- [x] T7. `SyncStore` port [ADR 0002]
- [x] T8. `InMemorySyncStore`: transaction with mutex and rollback [ADR 0009]
- [x] T9. Port contract suite [ADR 0002, 0012]
- [x] T10. `processBatch()` with retry [ADR 0006] and tests [S1, S9–S11, S13, S16, S18–S21]
- [x] T11. Concurrency tests [C1–C3]

**✅ Checkpoint 2**: core reviewed.

## Phase 3. API (NestJS)

- [x] T12. Nest app: `POST /sync`, `GET /notes/:id`, `GET /operations/:opId` [ADR 0004]
- [x] T13. Envelope: `400` (malformed) and `413` (more than 100 operations) [ADR 0004]
- [x] T14. E2E of S1 over HTTP [ADR 0012]

**✅ Checkpoint 3**: API reviewed.

## Phase 4. Web simulator

- [x] T15. Next.js with two devices [ADR 0011]
- [x] T16. Coalesce offline edits of the same note [ADR 0011]

**✅ Checkpoint 4**: simulator reviewed.

## Phase 5. Delivery

- [x] T17. ESLint with `import-x/no-extraneous-dependencies` [ADR 0001]
- [x] T18. Final README: install, run, highlighted tests, decisions, AI usage

**✅ Checkpoint 5**: delivery reviewed. Time spent and video link go in the README once recorded.
