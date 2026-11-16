import type { Conflict, Note } from '@offline-notes-sync/core';
import { describe, expect, it } from 'vitest';
import {
  applyResults,
  createDevice,
  editDraft,
  keepMine,
  keepServer,
  markSent,
  pull,
  save,
  type DeviceState,
} from './device';

const note = (revision: number, text: string): Note => ({ id: 'N', text, revision });

const conflict = (serverText: string, proposalText: string): Conflict => ({
  opId: 'O2',
  status: 'conflict',
  server: note(2, serverText),
  proposal: { noteId: 'N', baseRevision: 1, text: proposalText },
});

const onRevision1 = (): DeviceState => pull(createDevice('test'), note(1, 'a'));

describe('device: saving (ADR 0011)', () => {
  it('queues an operation on the revision the device knows', () => {
    const device = save(editDraft(onRevision1(), 'b'), 'N', 'O2');

    expect(device.queue).toEqual([{ opId: 'O2', noteId: 'N', baseRevision: 1, text: 'b', attempts: 0 }]);
  });

  it('coalesces edits while the operation was never sent', () => {
    let device = save(editDraft(onRevision1(), 'b'), 'N', 'O2');
    device = save(editDraft(device, 'bc'), 'N', 'O3');

    expect(device.queue).toEqual([{ opId: 'O2', noteId: 'N', baseRevision: 1, text: 'bc', attempts: 0 }]);
  });

  it('never changes an operation that was already sent', () => {
    let device = save(editDraft(onRevision1(), 'b'), 'N', 'O2');
    device = markSent(device).state;
    device = save(editDraft(device, 'bc'), 'N', 'O3');

    expect(device.queue.map((operation) => [operation.opId, operation.text])).toEqual([
      ['O2', 'b'],
      ['O3', 'bc'],
    ]);
  });
});

describe('device: applying results', () => {
  it('a lost response keeps the queue, so the next sync resends the same opId', () => {
    const device = markSent(save(editDraft(onRevision1(), 'b'), 'N', 'O2')).state;

    expect(markSent(device).operations.map((operation) => operation.opId)).toEqual(['O2']);
  });

  it('[R10] an old replayed receipt never moves the device backwards', () => {
    const device = pull(createDevice('test'), note(3, 'new'));
    const after = applyResults(device, [
      { opId: 'O2', status: 'updated', note: note(2, 'old'), replayed: true },
    ]);

    expect(after.known).toEqual(note(3, 'new'));
  });

  it('[S8, ADR 0010] settles an identical-text conflict without asking', () => {
    const device = applyResults(onRevision1(), [conflict('same', 'same')]);

    expect(device.conflict).toBeNull();
    expect(device.known).toEqual(note(2, 'same'));
  });

  it('[S5] keeps a real conflict for the person to decide', () => {
    const device = applyResults(onRevision1(), [conflict('theirs', 'mine')]);

    expect(device.conflict).toEqual(conflict('theirs', 'mine'));
  });

  it('never overwrites unsaved edits in the editor', () => {
    const device = editDraft(onRevision1(), 'typing...');
    const after = applyResults(device, [{ opId: 'X', status: 'updated', note: note(2, 'server') }]);

    expect(after.draft).toBe('typing...');
  });
});

describe('device: resolving a conflict (R11)', () => {
  it('keep mine queues a new operation on the server revision', () => {
    const device = keepMine(applyResults(onRevision1(), [conflict('theirs', 'mine')]), 'O9');

    expect(device.conflict).toBeNull();
    expect(device.queue).toEqual([{ opId: 'O9', noteId: 'N', baseRevision: 2, text: 'mine', attempts: 0 }]);
  });

  it('keep server catches up without sending anything', () => {
    const device = keepServer(applyResults(onRevision1(), [conflict('theirs', 'mine')]));

    expect(device.queue).toEqual([]);
    expect(device.known).toEqual(note(2, 'theirs'));
    expect(device.draft).toBe('theirs');
  });
});
