import type { Decision, Note, Operation, Receipt } from './types.js';

/**
 * The whole sync rule as a pure function (ADR 0003).
 * No I/O, no clock, no mutation: same inputs always give the same decision.
 *
 * @param operation an already validated operation (R5)
 * @param receipt   the stored receipt for `operation.opId`, if any
 * @param note      the current server state of `operation.noteId`, if any
 */
export function decide(operation: Operation, receipt: Receipt | null, note: Note | null): Decision {
  // R7/R8: a known opId is never processed again, whatever the note looks like now.
  if (receipt !== null) {
    return hasSameContent(receipt.operation, operation)
      ? { kind: 'replay', result: { ...receipt.result, replayed: true } }
      : { kind: 'reject', result: { opId: operation.opId, status: 'id_reused' } };
  }

  if (note === null) {
    // R2 creates; A4: any other base for a missing note is a conflict.
    return operation.baseRevision === 0 ? create(operation) : conflict(operation, null);
  }

  // R4, A3 (base 0 on an existing note), A7 (identical text): decided by revision only.
  if (operation.baseRevision !== note.revision) {
    return conflict(operation, note);
  }

  // R3: applies even when the text is unchanged.
  return update(operation, note);
}

/** A1: exact equality of the content fields; `opId` is the key, not content. */
export function hasSameContent(a: Operation, b: Operation): boolean {
  return a.noteId === b.noteId && a.baseRevision === b.baseRevision && a.text === b.text;
}

function create(operation: Operation): Decision {
  const note: Note = { id: operation.noteId, text: operation.text, revision: 1 };
  return {
    kind: 'create',
    note,
    receipt: { operation, result: { opId: operation.opId, status: 'created', note } },
  };
}

function update(operation: Operation, current: Note): Decision {
  const note: Note = { id: current.id, text: operation.text, revision: current.revision + 1 };
  return {
    kind: 'update',
    note,
    expectedRevision: current.revision,
    receipt: { operation, result: { opId: operation.opId, status: 'updated', note } },
  };
}

function conflict(operation: Operation, server: Note | null): Decision {
  return {
    kind: 'conflict',
    receipt: {
      operation,
      result: {
        opId: operation.opId,
        status: 'conflict',
        server,
        proposal: {
          noteId: operation.noteId,
          baseRevision: operation.baseRevision,
          text: operation.text,
        },
      },
    },
  };
}
