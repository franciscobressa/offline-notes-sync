# 0011. Web client: two-device simulator and offline queue

- Status: Accepted
- Date: 2026-11-12

## Context

The video must show the system working in a scenario different from the brief's example. Conflicts,
resends and reused `opId`s are hard to follow in terminal logs. The role also asks for Next.js. The
brief accepts a simulated client and server.

The client also has a behavior problem of its own: if someone saves the same note **twice while
offline**, two operations with the same `baseRevision` are created. On sync, the first is accepted
and the second **conflicts with the person's own edit**. The server is right (R4), but the
experience is bad.

## Decision

### The simulator

- A **Next.js (App Router)** app with **two devices side by side**, each with:
  - its local copy of the note and the `baseRevision` it knows;
  - an **online/offline** toggle;
  - a **local queue** of pending operations, sent as one batch through `POST /sync`;
  - a **conflict panel**, with server and proposal side by side and three actions: keep the
    server's, keep mine or edit by hand. Any choice creates a new operation (R11);
  - **"Sync, lose response"** and **"Resend last batch"** buttons, to demonstrate idempotency.
- **The `opId` is generated when the edit is saved** (`crypto.randomUUID()`), when the operation
  enters the queue, **not when it is sent**. So a resend always uses the same id.
- The web app calls the API through **Next `rewrites`** (`/api/*` → API). Same origin in the browser,
  so no CORS setup.
- The web app imports only **types** from the core (`import type`), never the decision logic. The
  server always decides.

### The offline queue

The queue is the client's *outbox*: an operation leaves it only when a result with the same `opId`
arrives (*Guaranteed Delivery*). The rules, in [`apps/web/lib/device.ts`](../../apps/web/lib/device.ts):

- If the queue's last operation for the note **was never sent**, saving again **replaces its text**,
  keeping the same `opId` and base. The server never saw it, so changing it is safe.
- Once sent at least once, an operation **never changes**. It may have been applied with the response
  lost, and changing its content would turn the resend into `id_reused`. A new edit becomes a new
  operation.
- The client **never moves its known revision backwards**: a replayed receipt can carry an old
  revision (R10) and is ignored in that case.

## Alternatives considered

- **Only a CLI demo script**: cheaper and reproducible, but the video is less clear.
- **Simulating devices inside the server**: it would hide the protocol. Devices must talk to the API
  the way real clients would.
- **A queue persisted in IndexedDB / Service Worker**: how a real offline-first app would work, but
  out of scope (the brief does not require storage).
- **Generating the `opId` at send time**: a retry would get a new id, and the server would apply the
  same edit twice. That defeats idempotency.
- **Chaining bases** (the second operation uses the first one's base + 1, predicting the server): if
  the first one conflicts, every following one starts from a revision that never existed.
- **The server merging operations from the same client**: it would need client identity, which is
  out of scope, and would hide a user-experience rule in the server.

## Consequences

- **Positive**: the demo is visual and self-explanatory, and uses the role's Next.js without putting
  business rules in the front end. The common case (several offline edits in a row) does not
  conflict with itself, and no server rule changes.
- **Negative**: one more app to maintain and run, with more time spent on UI. Intermediate versions
  never reach the server, only the last one.
- **Limits**:
  - The queue lives in React state, so reloading the page loses it. "Offline" is simulated (the toggle
    blocks sending), without intercepting the real network. There is no automatic retry: the person
    clicks Sync. A real app would retry on reconnect with exponential backoff and jitter.
  - After a **lost response**, the sent operation stays in the queue unconfirmed. A new edit in that
    window still conflicts with it. Fixing that would need client identity or chained bases.
