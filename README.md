# Offline Notes Sync

Solution to **Case 05: Offline note sync**.

- **Chosen focus**: architecture and system design (back end), with a web simulator for the demo.
- **Stack**: TypeScript, NestJS and Next.js, in an npm workspaces monorepo. Everything in memory.
- **Time spent**: about 6 hours.
- **Video**: https://www.youtube.com/watch?v=vHWs8ugR4_Y

Devices edit notes offline and sync later. The server accepts safe edits, returns a **conflict**
instead of overwriting work, and turns **resends** into responses identical to the original ones,
without applying anything twice.

## Requirements

- **Node.js 24+** (npm 11 comes with it). Nothing else.

## How to run

**1. Once**

```bash
npm install
npm run build
```

**2. Check**

```bash
npm test         # 91 tests
```

**3. Browser simulator**, with two terminals:

```bash
npm run start:api    # terminal 1: the API, at http://localhost:3001
npm run dev:web      # terminal 2: the UI, at http://localhost:3000
```

Lint and types: `npm run lint` and `npm run typecheck`.

## Reproducible demo

Through the API, with it running (`npm run start:api`):

```bash
curl -X POST localhost:3001/sync -H 'Content-Type: application/json' -d '{"operations":[
  {"opId":"O1","noteId":"N","baseRevision":0,"text":"initial"},
  {"opId":"O2","noteId":"N","baseRevision":1,"text":"edit A"},
  {"opId":"O3","noteId":"N","baseRevision":1,"text":"edit B"}]}'
curl localhost:3001/notes/N
curl localhost:3001/operations/O3
```

In the **web simulator**, each device has an online/offline toggle, a local queue, the conflict
panel and two buttons to demonstrate idempotency: **"Sync, lose response"** (the server processes the
batch, but the device never sees the response) and **"Resend last batch"**.

## API

| Method | Route | Response |
|---|---|---|
| `POST` | `/sync` | `{ operations: [...] }` → `200 { results: [...] }`, one per operation, in the same order. `400` for a malformed envelope, `413` above 100 operations. |
| `GET` | `/notes/:id` | The note's current state, or `404`. |
| `GET` | `/operations/:opId` | The operation's stored receipt, or `404`. |

## Architecture in one minute

```
packages/core   the hexagon, no framework
  domain/         parseOperation() and decide(): pure functions, no I/O and no clock
  application/    processBatch(): one transaction per operation + retry; SyncStore port
  adapters/memory InMemorySyncStore: mutex, rollback and CAS
apps/api        NestJS: only translates HTTP into core calls
apps/web        Next.js: simulator with two devices
```

- **Functional core, imperative shell**: the whole rule is in `decide()`, a pure function. The shell
  opens the transaction, loads the state, calls `decide()` and writes.
- **Hexagonal**: the core defines the `SyncStore` port. Today the only adapter is in memory; a
  database would come in as another adapter, without touching the core, and would have to pass the
  same contract suite.
- **Concurrency**: optimistic between client and server (by revision). On the server, each operation
  runs in its own transaction; conditional writes (CAS and "is this opId taken?") detect races and
  the core decides again.

Details in the [plan](specs/plan.md) and the [ADRs](docs/adr/README.md).

## Tests

| Layer | Where | Count |
|---|---|---|
| Domain (`parseOperation`, `decide`) | `packages/core` | 36 |
| Application, retry, concurrency and adapter contract | `packages/core` | 34 |
| HTTP E2E (NestJS) | `apps/api` | 11 |
| Device logic (simulator) | `apps/web` | 10 |

Each test name starts with the ID of the rule or scenario in the [spec](specs/spec.md), such as
`[S15]`.

### Three highlighted tests

1. **`[C2]` concurrent edits on the same base** (`concurrency.test.ts`). 20 different operations on
   base 1 arrive at the same time. **Expected**: exactly one `updated`, 19 `conflict` and the note at
   revision 2. **Bug it catches**: *lost update*, when two edits both "win" and one silently erases
   the other. Node runs on one thread, but `async/await` interleaves transactions at every `await`:
   remove the adapter's mutex and this test fails.
2. **`[S1]` step 6: resending a conflict after the note changed** (`process-batch.test.ts`, and also
   over HTTP). **Expected**: the original receipt, showing **revision 2**, with `replayed: true`,
   while the query shows revision 3. **Bug it catches**: rebuilding the receipt from the current
   state (it would show revision 3) or processing the operation again.
3. **`[S10]` and `[S11]` validation vs. idempotency** (`process-batch.test.ts`). An invalid operation
   does not take the `opId`, and an invalid one that reuses a stored `opId` stays `invalid`. **Bug it
   catches**: validating after looking up the receipt, or storing invalid operations.

Beyond the tests, I ran **manual mutation testing**: I broke the rule on purpose and confirmed that a
test fails. The list is in [AI usage](#ai-usage).

## Two decisions

**1. Concurrency on a single-threaded server** ([ADR 0006](docs/adr/0006-transaction-per-operation.md), [ADR 0009](docs/adr/0009-in-memory-persistence.md))

- *What I wanted to check*: whether, without a database, two simultaneous requests could overwrite
  each other or apply the same operation twice.
- *How I investigated*: Node runs on one thread, but every `await` hands control back to the event
  loop. Two transactions can read the same revision before either writes. I wrote scenarios C1 to C3
  (20 simultaneous requests) and removed the adapter's mutex to see what happened: all three fail.
- *Conclusion*: the adapter serializes transactions with a mutex, and the port keeps conditional
  writes with retry. A future database adapter replaces the mutex with `WHERE revision = $base` and
  a primary key on `op_id`, without changing the core.

**2. Identical text on a stale base** ([ADR 0010](docs/adr/0010-conflict-on-identical-text.md))

- *What I wanted to check*: whether an edit arriving on an old base, but with the same text the
  server already has, should be accepted.
- *How I investigated*: the brief defines both ends by the revision, never by the text: a different
  base is a conflict (R4), and the same text on the right base still bumps the revision (R3).
  Accepting it "because the text is the same" would be automatic resolution, which the brief
  forbids.
- *Conclusion*: on the server, it is still a conflict. The simulator settles this case on its own,
  without asking the person.

## Assumptions

The brief leaves gaps on purpose. The choices are in the [spec](specs/spec.md#assumptions-gaps-in-the-brief)
(A1 to A9), for example:

- base 0 for an existing note is a **conflict**, not a validation error;
- identical text on a stale base **is a conflict** ([ADR 0010](docs/adr/0010-conflict-on-identical-text.md));
- a resend returns the identical receipt with `replayed: true`.

## AI usage

I used AI (Claude) as a pair: to discuss alternatives, draft ADRs and the spec, and write code and
tests. I made the decisions, one by one, with the alternatives recorded in the ADRs. The code was
checked with tests and manual mutation testing.

| Where | AI suggestion or output | What I did | How I checked |
|---|---|---|---|
| ADR 0006 | Claimed the retry converges after 1 repetition | Corrected it to 3 attempts in the worst case, with a test covering that path | Walked through "CAS fails → receipt fails → replay" by hand; with `MAX_ATTEMPTS = 2`, the test fails |
| `decide()` tests | 34 tests, all passing | Added scenario S22 (base ahead of the server) | Mutation: changing `!==` to `<` broke no test; with S22, it does |
| `processBatch()` and the in-memory adapter | Implementation and tests | Kept | 4 mutations (retry limit, conflict without receipt, ignoring a lost CAS, no rollback): all caught |
| Concurrency | Tests C1 to C3 | Kept | Removing the adapter's mutex makes C1, C2 and C3 fail |
| TypeScript | `npm install` brought TypeScript 7 | Pinned 5.9 ([ADR 0001](docs/adr/0001-stack.md)) | The 7.x package lacks the JS API that ESLint, Next and Nest use |
| Simulator | `keepMine` reused `save()` | Rewrote it to build the operation on the server's revision | Review: coalescing into an older operation would keep the stale base and cause another conflict |
| ESLint | Rule against undeclared dependencies | Kept | Imported an undeclared package in the core on purpose: lint flagged it |

## Limits and open items

- **In memory only**: data is lost when the API restarts, and the mutex protects a single instance.
  The next step is a database adapter ([ADR 0009](docs/adr/0009-in-memory-persistence.md)).
- **Granularity**: conflicts are per whole note, so two people editing different paragraphs also
  conflict.
- **Receipt retention**: receipts grow forever. In production they would expire with the resend
  window.
- **No authentication**: the `opId` scope is global. With identity, it would be `(client_id, op_id)`.
- **Simulator**: the queue lives in browser memory, and there is no automatic retry. After a lost
  response, a new edit still conflicts with the previous one
  ([ADR 0011](docs/adr/0011-web-client.md)). There is no browser test (Playwright); the device logic
  is unit-tested.
- **No CI configured.**

## Documentation map

| Document | Contents |
|---|---|
| [specs/spec.md](specs/spec.md) | **What**: rules (R1 to R11), assumptions (A1 to A9), scenarios (S1 to S22, C1 to C3) |
| [specs/plan.md](specs/plan.md) | **How**: overview, flow, where each guarantee lives, how it would evolve |
| [specs/tasks.md](specs/tasks.md) | **Steps**: implementation tasks and checkpoints |
| [docs/adr/](docs/adr/README.md) | 12 decisions, with alternatives, trade-offs and limits |
