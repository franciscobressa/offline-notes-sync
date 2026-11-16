# 0002. Hexagonal architecture: packages, the `SyncStore` port and a contract suite

- Status: Accepted
- Date: 2026-11-12

## Context

The sync rule must not depend on how data is stored. Today storage is in memory
([ADR 0009](0009-in-memory-persistence.md)), but a database is the natural next step to persist and
scale. Swapping storage must not require touching the rules or rewriting the tests. The rule must
not depend on the web framework either.

## Decision

**Hexagonal architecture (Ports & Adapters)**, from Alistair Cockburn (2005). The application
defines an output port for persistence, and the implementations live outside it.

### Packages

```
offline-notes-sync/
├── packages/
│   └── core/                    # the hexagon: no framework dependency
│       ├── src/domain/          # pure: types, schemas, decide()
│       ├── src/application/     # orchestration: processBatch(), SyncStore port
│       └── src/adapters/memory/ # InMemorySyncStore (reference adapter, no dependencies)
├── apps/
│   ├── api/                     # NestJS: HTTP adapter (driving side)
│   └── web/                     # Next.js: device simulator (an HTTP client)
├── specs/                       # SDD: spec, plan and tasks
└── docs/
```

- The **port and the application service live in the core**, in `application/`. The whole hexagon
  (domain and application) does not know NestJS exists.
- **NestJS is only a driving adapter**: the controller validates the HTTP envelope and calls
  `processBatch()`.
- The **in-memory adapter lives in the core**. It has no dependencies and is the reference
  implementation of the port.
- An adapter with infrastructure dependencies (a database, for example) would live in `apps/api` or
  in its own package, so the core stays dependency-free.
- Dependency rule: `domain` imports nothing from `application`, `application` imports `domain`,
  `apps/*` import `core`, and `core` never imports `apps/*`.

### The port

```ts
interface SyncStore {
  transaction<T>(work: (tx: SyncTransaction) => Promise<T>): Promise<T>;
  getNote(noteId: string): Promise<Note | null>;        // query (R10)
  getReceipt(opId: string): Promise<Receipt | null>;    // receipt lookup
}

interface SyncTransaction {
  findReceipt(opId: string): Promise<Receipt | null>;
  findNote(noteId: string): Promise<Note | null>;
  insertNote(note: Note): Promise<boolean>;                            // false: already exists
  updateNote(note: Note, expectedRevision: number): Promise<boolean>;  // false: revision changed
  insertReceipt(receipt: Receipt): Promise<boolean>;                   // false: opId taken
}
```

- The port is shaped around the **unit of work** (the transaction). Writes only exist inside
  `SyncTransaction`, so nothing can be written outside a transaction.
- Writes return `false` instead of throwing when a concurrency condition fails. This keeps the retry
  explicit in the application ([ADR 0006](0006-transaction-per-operation.md)).
- **A contract test suite** describes what every adapter must do (transaction, rollback, CAS,
  immutable receipt). It runs against the in-memory adapter, and any future adapter must pass it
  ([ADR 0012](0012-testing-strategy.md)).

## Alternatives considered

- **Layered NestJS (controller → service → repository)**: the most common shape in NestJS and
  enough for a project this size. But the order of the batch and "one result per operation" (R9)
  could only be tested by booting Nest, and the rule would be tied to the framework.
- **No port, with the maps used directly in the service**: shorter, but it mixes rule and storage.
  Moving to a database later would mean rewriting the orchestration and the tests.
- **One repository per entity** (`NoteRepository`, `OperationRepository`): common in tutorials, but
  the atomicity between "apply the note" and "store the receipt" would sit between two
  repositories.
- **One package per adapter** (`packages/store-memory` and so on): stricter boundaries, but a
  package for a single dependency-free adapter is ceremony.
- **A `contracts` package just for DTOs and schemas**: the schemas are business rules (R5) and
  belong in the domain. A contracts-only package would be an empty layer.

## Consequences

- **Positive**: every rule, including batch order and independence, is tested without a framework or
  a database. A database would come in as another adapter, without touching the core, and the
  contract suite says exactly what it must guarantee. Replacing NestJS with another edge (a CLI, a
  queue consumer) does not touch the core either.
- **Negative**:
  - The port is an abstraction with a single implementation today, which can look like speculative
    generality. The cost was kept small: two interfaces and one test suite.
  - The NestJS controller is thin, almost a pass-through, which can look like an extra layer.
  - Keeping the in-memory adapter in the core mixes a bit of "infrastructure" into the hexagon.
    Accepted because it has no dependencies and the core's own tests use it.
- **Limits**: the port assumes short, single-operation transactions. If an operation ever needs to
  touch several notes, the interface would change. With more adapters or teams, the adapters should
  move to their own packages, with dependency rules enforced by a tool (dependency-cruiser or Nx
  boundaries).
