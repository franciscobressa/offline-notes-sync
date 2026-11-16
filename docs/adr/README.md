# Architecture Decision Records

Every relevant architecture decision in this project is recorded here, one file per decision.

## Format

Each ADR follows Michael Nygard's format (*Documenting Architecture Decisions*, 2011): context,
decision and consequences. The "Alternatives considered" section comes from MADR (*Markdown Any
Decision Records*), because the "why X and not Y" is exactly what these records should show.

Only decisions with a real alternative and a cost to reverse become an ADR. Trivial choices, such as
variable names, do not.

## Status

- **Accepted**: decided; the code follows it.
- **Proposed**: recorded, waiting for a decision.
- **Superseded by NNNN**: no longer valid; kept for history.

An accepted ADR is not rewritten. If the decision changes, a new ADR supersedes it and the old one
gets the status "Superseded by NNNN".

## Index

Start with the six in bold: they hold the core of the design.

| No. | Decision | Status |
|---|---|---|
| [0001](0001-stack.md) | Stack: TypeScript, Node.js 24 and npm workspaces | Accepted |
| [0002](0002-hexagonal-architecture.md) | **Hexagonal architecture: packages, the `SyncStore` port and a contract suite** | Accepted |
| [0003](0003-functional-core-imperative-shell.md) | **Functional Core, Imperative Shell** | Accepted |
| [0004](0004-http-batch-api.md) | HTTP API with a batch endpoint (`POST /sync`) | Accepted |
| [0005](0005-optimistic-concurrency.md) | **Optimistic concurrency by revision (client ↔ server)** | Accepted |
| [0006](0006-transaction-per-operation.md) | **One transaction per operation, CAS and retry** | Accepted |
| [0007](0007-idempotency-by-op-id.md) | **Idempotency by `opId`** | Accepted |
| [0008](0008-data-contract.md) | Data contract: Zod at the edge, results as a discriminated union | Accepted |
| [0009](0009-in-memory-persistence.md) | In-memory persistence | Accepted |
| [0010](0010-conflict-on-identical-text.md) | **Identical text on a stale base is still a conflict** | Accepted |
| [0011](0011-web-client.md) | Web client: two-device simulator and offline queue | Accepted |
| [0012](0012-testing-strategy.md) | Testing strategy and traceability to the spec | Accepted |

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context
What problem or force requires a decision.

## Decision
What was decided, in a verifiable way.

## Alternatives considered
For each one: what it is and why it was not chosen.

## Consequences
Positive, negative (accepted trade-offs) and limits: when to revisit.
```
