import { describe, expect, it } from 'vitest';
import { decide } from './decide.js';
import type { Note, Operation, Receipt } from './types.js';

const operation = (overrides: Partial<Operation> = {}): Operation => ({
  opId: 'O1',
  noteId: 'N',
  baseRevision: 0,
  text: 'a',
  ...overrides,
});

const note = (revision: number, text: string): Note => ({ id: 'N', text, revision });

describe('decide: creation and update', () => {
  it('[S2] creates the note at revision 1 when base is 0 and the note does not exist', () => {
    const op = operation({ baseRevision: 0, text: 'a' });
    const created = note(1, 'a');

    expect(decide(op, null, null)).toEqual({
      kind: 'create',
      note: created,
      receipt: { operation: op, result: { opId: 'O1', status: 'created', note: created } },
    });
  });

  it('[S3] updates and bumps the revision even when the text is unchanged', () => {
    const op = operation({ opId: 'O2', baseRevision: 1, text: 'a' });
    const updated = note(2, 'a');

    expect(decide(op, null, note(1, 'a'))).toEqual({
      kind: 'update',
      note: updated,
      expectedRevision: 1,
      receipt: { operation: op, result: { opId: 'O2', status: 'updated', note: updated } },
    });
  });

  it('[S4] accepts an empty text as a regular edit', () => {
    const decision = decide(operation({ baseRevision: 1, text: '' }), null, note(1, 'a'));

    expect(decision).toMatchObject({ kind: 'update', note: note(2, '') });
  });
});

describe('decide: conflicts', () => {
  it('[S5] returns the server state and the proposal when the base is stale', () => {
    const op = operation({ opId: 'O3', baseRevision: 1, text: 'y' });
    const server = note(2, 'x');

    expect(decide(op, null, server)).toEqual({
      kind: 'conflict',
      receipt: {
        operation: op,
        result: {
          opId: 'O3',
          status: 'conflict',
          server,
          proposal: { noteId: 'N', baseRevision: 1, text: 'y' },
        },
      },
    });
  });

  it('[S22] is a conflict when the base is ahead of the server', () => {
    const decision = decide(operation({ baseRevision: 5 }), null, note(2, 'x'));

    expect(decision.kind).toBe('conflict');
  });

  it('[S6] reports server: null when base > 0 targets a missing note', () => {
    const decision = decide(operation({ baseRevision: 3 }), null, null);

    expect(decision).toMatchObject({ kind: 'conflict', receipt: { result: { server: null } } });
  });

  it('[S7] treats base 0 on an existing note as a conflict, not as a creation', () => {
    const server = note(1, 'a');
    const decision = decide(operation({ baseRevision: 0, text: 'b' }), null, server);

    expect(decision).toMatchObject({ kind: 'conflict', receipt: { result: { server } } });
  });

  it('[S8] is still a conflict when a stale base carries the exact server text', () => {
    const decision = decide(operation({ baseRevision: 1, text: 'x' }), null, note(2, 'x'));

    expect(decision.kind).toBe('conflict');
  });
});

describe('decide: idempotency', () => {
  const original = operation({ opId: 'O2', baseRevision: 1, text: 'a' });
  const receipt: Receipt = {
    operation: original,
    result: { opId: 'O2', status: 'updated', note: note(2, 'a') },
  };

  it('[S14] replays the original receipt for an identical resend', () => {
    expect(decide({ ...original }, receipt, note(2, 'a'))).toEqual({
      kind: 'replay',
      result: { ...receipt.result, replayed: true },
    });
  });

  it('[S15] replays the original data even after the note moved on', () => {
    const decision = decide({ ...original }, receipt, note(7, 'much later'));

    expect(decision).toMatchObject({ kind: 'replay', result: { note: note(2, 'a') } });
  });

  it.each([
    ['text', { text: 'b' }],
    ['baseRevision', { baseRevision: 2 }],
    ['noteId', { noteId: 'OTHER' }],
  ])('[S16] rejects a reused opId with a different %s', (_field, change) => {
    expect(decide({ ...original, ...change }, receipt, note(2, 'a'))).toEqual({
      kind: 'reject',
      result: { opId: 'O2', status: 'id_reused' },
    });
  });

  it('[S17] compares text exactly, without normalizing whitespace', () => {
    const decision = decide({ ...original, text: 'a ' }, receipt, note(2, 'a'));

    expect(decision.kind).toBe('reject');
  });
});
