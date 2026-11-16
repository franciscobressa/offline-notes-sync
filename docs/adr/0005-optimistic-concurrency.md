# 0005. Optimistic concurrency by revision (client ↔ server)

- Status: Accepted
- Date: 2026-11-12

## Context

Devices edit **while disconnected**. There is no way to ask the server to lock a note before
editing, because the server is unreachable. The brief also forbids silently overwriting work,
merging texts automatically and using the device clock to pick a winner.

## Decision

- **Optimistic concurrency control** (Fowler's *Optimistic Offline Lock*): each note has an integer
  `revision`. The client sends the revision it started from (`baseRevision`), and the write is only
  accepted if that is still the current revision. Otherwise the result is `conflict`, with both
  versions.
- Checking and writing happen **in a single atomic step** (*compare-and-set*): in the port,
  `updateNote(note, expectedRevision)` returns `false` if the revision changed. In the in-memory
  adapter this runs inside the serialized transaction ([ADR 0009](0009-in-memory-persistence.md)). In
  a database it would be a single statement:

  ```sql
  UPDATE notes
     SET text = $text, revision = revision + 1
   WHERE id = $id AND revision = $expectedRevision;   -- 0 rows: someone changed it first
  ```

  ```sql
  INSERT INTO notes (id, text, revision) VALUES ($id, $text, 1)
  ON CONFLICT (id) DO NOTHING;                         -- 0 rows: the note already exists
  ```

- The revision is a **per-note counter**, controlled only by the server. It is not a timestamp or a
  hash.

## Alternatives considered

- **Pessimistic locking** (`SELECT ... FOR UPDATE`, leases, checkout): requires talking to the server
  before editing, which is impossible offline. A lock held by a device that never comes back would
  block the note.
- **Last-write-wins by timestamp**: forbidden by the brief. It silently loses work and depends on
  device clocks, which drift and can be tampered with.
- **CRDT or OT** (Yjs, Automerge): they merge automatically, which the brief forbids, and they would
  be out of proportion for the scope.
- **Vector clocks**: they detect concurrency between replicas **without** a central coordinator.
  Here a central server is the source of truth, so a simple counter is enough.
- **ETag as a content hash**: also detects changes, but the brief requires the revision to increase
  even when the text is the same (R3), and a hash would not change.

## Consequences

- **Positive**: works offline. Nobody blocks anybody. No write is lost silently. The rule fits in one
  comparison.
- **Negative**: the cost of a conflict falls on the user, who resolves it by hand. With heavy
  contention on the same note, conflicts become frequent rework.
- **Limits**: the granularity is the **whole note**. Two people editing different paragraphs still
  conflict. If that is common in real use, the next step is finer granularity (per block or
  paragraph) or CRDTs, which would mean revisiting the "no automatic merge" requirement.
