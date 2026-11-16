import type { Conflict, Note, Operation, OperationResult } from '@offline-notes-sync/core';

/** An operation waiting in the device's local queue. */
export interface PendingOperation extends Operation {
  /** How many times this exact operation was sent. Once sent, it is never changed (ADR 0011). */
  readonly attempts: number;
}

/**
 * Client-side state of one simulated device. All functions below are pure:
 * the component does the I/O and feeds the results back in.
 */
export interface DeviceState {
  readonly name: string;
  readonly online: boolean;
  /** Last server state this device confirmed. `null` means it never saw the note. */
  readonly known: Note | null;
  /** What is in the editor right now. */
  readonly draft: string;
  readonly queue: readonly PendingOperation[];
  readonly conflict: Conflict | null;
  /** The last batch sent, kept to demonstrate replays (R7). */
  readonly lastBatch: readonly Operation[];
  readonly log: readonly string[];
}

const LOG_SIZE = 8;

export function createDevice(name: string): DeviceState {
  return {
    name,
    online: true,
    known: null,
    draft: '',
    queue: [],
    conflict: null,
    lastBatch: [],
    log: [],
  };
}

export const shortId = (opId: string | null): string => (opId ?? '?').slice(0, 8);

export function addLog(state: DeviceState, line: string): DeviceState {
  return { ...state, log: [line, ...state.log].slice(0, LOG_SIZE) };
}

export function setOnline(state: DeviceState, online: boolean): DeviceState {
  return addLog({ ...state, online }, online ? 'back online' : 'went offline');
}

export function editDraft(state: DeviceState, draft: string): DeviceState {
  return { ...state, draft };
}

/**
 * Saves the draft as an operation (ADR 0011).
 * - If the last queued operation for this note was never sent, its text is replaced:
 *   the server never saw it, so this is safe and avoids a conflict with ourselves.
 * - Otherwise a new operation is queued on the revision this device knows.
 *   `opId` is created here, at edit time, so every resend reuses it (ADR 0011).
 */
export function save(state: DeviceState, noteId: string, newOpId: string): DeviceState {
  const last = state.queue.at(-1);
  if (last !== undefined && last.noteId === noteId && last.attempts === 0) {
    const merged: PendingOperation = { ...last, text: state.draft };
    return addLog(
      { ...state, queue: [...state.queue.slice(0, -1), merged] },
      `${shortId(last.opId)} updated in the queue (not sent yet)`,
    );
  }

  const operation: PendingOperation = {
    opId: newOpId,
    noteId,
    baseRevision: state.known?.revision ?? 0,
    text: state.draft,
    attempts: 0,
  };
  return addLog(
    { ...state, queue: [...state.queue, operation] },
    `${shortId(newOpId)} queued on rev ${operation.baseRevision}`,
  );
}

/** Marks the whole queue as sent and returns what to put on the wire. */
export function markSent(state: DeviceState): { state: DeviceState; operations: Operation[] } {
  const operations = state.queue.map(({ attempts: _attempts, ...operation }) => operation);
  return {
    state: {
      ...state,
      queue: state.queue.map((operation) => ({ ...operation, attempts: operation.attempts + 1 })),
      lastBatch: operations,
    },
    operations,
  };
}

/**
 * Adopts a server state, but never moves backwards: a replayed receipt may carry
 * an old revision (R10). Unsaved edits in the editor are never overwritten.
 */
function adopt(state: DeviceState, note: Note | null, force = false): DeviceState {
  if (!force && note !== null && state.known !== null && note.revision <= state.known.revision) {
    return state;
  }
  const editorIsClean = state.draft === (state.known?.text ?? '');
  return {
    ...state,
    known: note,
    draft: editorIsClean && note !== null ? note.text : state.draft,
  };
}

export function applyResults(state: DeviceState, results: readonly OperationResult[]): DeviceState {
  return results.reduce(applyResult, state);
}

function applyResult(state: DeviceState, result: OperationResult): DeviceState {
  const next: DeviceState = {
    ...state,
    queue: state.queue.filter((operation) => operation.opId !== result.opId),
  };
  const replayed = 'replayed' in result ? ' (replayed)' : '';
  const id = shortId(result.opId);

  switch (result.status) {
    case 'created':
    case 'updated':
      return addLog(adopt(next, result.note), `${id} ${result.status}${replayed} → rev ${result.note.revision}`);
    case 'conflict':
      // ADR 0010: identical text is still a conflict on the server; the client settles it silently.
      if (result.server !== null && result.server.text === result.proposal.text) {
        return addLog(adopt(next, result.server, true), `${id} conflict with identical text: adopted rev ${result.server.revision}`);
      }
      return addLog({ ...next, conflict: result }, `${id} conflict${replayed}: choose a version`);
    case 'invalid':
      return addLog(next, `${id} invalid: ${result.errors.map((error) => `${error.path} ${error.message}`).join('; ')}`);
    case 'id_reused':
      return addLog(next, `${id} id_reused: the server already has a different operation with this id`);
  }
}

/** Keep the server's version: nothing is sent, the device simply catches up. */
export function keepServer(state: DeviceState): DeviceState {
  if (state.conflict === null) return state;
  const { server } = state.conflict;
  return addLog(
    { ...state, conflict: null, known: server, draft: server?.text ?? '' },
    `kept the server version${server ? ` (rev ${server.revision})` : ''}`,
  );
}

/** Keep my version: a new operation on the current server revision (R11). */
export function keepMine(state: DeviceState, newOpId: string): DeviceState {
  if (state.conflict === null) return state;
  const { server, proposal } = state.conflict;
  // Built explicitly instead of via save(): coalescing into an older unsent
  // operation would keep its stale base and conflict again.
  const operation: PendingOperation = {
    opId: newOpId,
    noteId: proposal.noteId,
    baseRevision: server?.revision ?? 0,
    text: proposal.text,
    attempts: 0,
  };
  return addLog(
    { ...state, conflict: null, known: server, draft: proposal.text, queue: [...state.queue, operation] },
    `kept my version: ${shortId(newOpId)} queued on rev ${operation.baseRevision}`,
  );
}

/** Merge by hand: both texts go to the editor, on top of the current server revision. */
export function editManually(state: DeviceState): DeviceState {
  if (state.conflict === null) return state;
  const { server, proposal } = state.conflict;
  const merged = server === null ? proposal.text : `${server.text}\n${proposal.text}`;
  return addLog(
    { ...state, conflict: null, known: server, draft: merged },
    'merging by hand: edit, then save',
  );
}

/** Pulls the server state. Refused while operations are pending, to avoid losing them. */
export function pull(state: DeviceState, note: Note | null): DeviceState {
  if (state.queue.length > 0) {
    return addLog(state, 'sync the pending queue before pulling');
  }
  return addLog(adopt(state, note, true), note ? `pulled rev ${note.revision}` : 'note not on the server yet');
}
