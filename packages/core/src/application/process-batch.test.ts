import { beforeEach, describe, expect, it } from 'vitest';
import { InMemorySyncStore } from '../adapters/memory/in-memory-sync-store.js';
import type { Note, OperationResult, Receipt } from '../domain/types.js';
import { MAX_ATTEMPTS, processBatch, RetriesExhaustedError } from './process-batch.js';
import type { SyncStore, SyncTransaction } from './sync-store.js';

const op = (opId: string, baseRevision: number, text: string, noteId = 'N') => ({
  opId,
  noteId,
  baseRevision,
  text,
});

const note = (revision: number, text: string): Note => ({ id: 'N', text, revision });

let store: InMemorySyncStore;

beforeEach(() => {
  store = new InMemorySyncStore();
});

/** Sends a single operation and returns its only result. */
async function send(input: unknown, target: SyncStore = store): Promise<OperationResult> {
  const [result] = await processBatch(target, [input]);
  if (result === undefined) throw new Error('expected exactly one result');
  return result;
}

describe('processBatch: the scenario from the case description', () => {
  it('[S1] create, update, conflict, replays, resolution and reused id', async () => {
    const created = await send(op('O1', 0, 'initial'));
    expect(created).toEqual({ opId: 'O1', status: 'created', note: note(1, 'initial') });

    const updated = await send(op('O2', 1, 'edit A'));
    expect(updated).toEqual({ opId: 'O2', status: 'updated', note: note(2, 'edit A') });

    const conflict = await send(op('O3', 1, 'edit B'));
    expect(conflict).toEqual({
      opId: 'O3',
      status: 'conflict',
      server: note(2, 'edit A'),
      proposal: { noteId: 'N', baseRevision: 1, text: 'edit B' },
    });

    expect(await send(op('O2', 1, 'edit A'))).toEqual({ ...updated, replayed: true });
    expect(await store.getNote('N')).toEqual(note(2, 'edit A'));

    expect(await send(op('O4', 2, 'A + B'))).toEqual({
      opId: 'O4',
      status: 'updated',
      note: note(3, 'A + B'),
    });

    // The receipt still shows revision 2; the query shows the current revision 3 (R10).
    expect(await send(op('O3', 1, 'edit B'))).toEqual({ ...conflict, replayed: true });
    expect(await store.getNote('N')).toEqual(note(3, 'A + B'));

    expect(await send(op('O2', 1, 'other text'))).toEqual({ opId: 'O2', status: 'id_reused' });
    expect(await store.getNote('N')).toEqual(note(3, 'A + B'));
  });
});

describe('processBatch: rules', () => {
  it('[R6] stores the receipt of a conflict', async () => {
    await send(op('O1', 0, 'a'));
    await send(op('O2', 0, 'b'));

    expect(await store.getReceipt('O2')).toMatchObject({ result: { status: 'conflict' } });
  });

  it('[S9] resolves a conflict with a new operation on the current base', async () => {
    await send(op('O1', 0, 'x'));
    await send(op('O2', 1, 'x2'));
    await send(op('O3', 1, 'y'));

    expect(await send(op('O4', 2, 'x2 + y'))).toMatchObject({
      status: 'updated',
      note: note(3, 'x2 + y'),
    });
  });

  it('[S10] an invalid operation does not take its opId', async () => {
    expect(await send(op('X', -1, 'a'))).toMatchObject({ opId: 'X', status: 'invalid' });
    expect(await store.getReceipt('X')).toBeNull();

    expect(await send(op('X', 0, 'a'))).toMatchObject({ opId: 'X', status: 'created' });
  });

  it('[S11] an invalid operation reusing a taken opId is invalid, not a replay', async () => {
    await send(op('O1', 0, 'a'));

    expect(await send(op('O1', -1, 'a'))).toMatchObject({ status: 'invalid' });
  });

  it('[S13] a resend without an unknown field is the same content', async () => {
    await send({ ...op('O1', 0, 'a'), extra: true });

    expect(await send(op('O1', 0, 'a'))).toMatchObject({ status: 'created', replayed: true });
  });

  it('[S16] id_reused is not stored, so the original content still replays', async () => {
    await send(op('O2', 0, 'a'));

    expect(await send(op('O2', 0, 'b'))).toEqual({ opId: 'O2', status: 'id_reused' });
    expect(await send(op('O2', 0, 'a'))).toMatchObject({ status: 'created', replayed: true });
  });

  it('[S18] keeps order and independence inside a batch', async () => {
    await send(op('O1', 0, 'a'));

    const results = await processBatch(store, [
      op('BAD', -1, 'x'),
      op('O2', 1, 'b'),
      op('O3', 1, 'c'),
      op('O4', 2, 'd'),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'invalid',
      'updated',
      'conflict',
      'updated',
    ]);
    expect(await store.getNote('N')).toEqual(note(3, 'd'));
  });

  it('[S19] a repeated opId in the same batch is a replay', async () => {
    const results = await processBatch(store, [op('O1', 0, 'a'), op('O1', 0, 'a')]);

    expect(results).toEqual([
      { opId: 'O1', status: 'created', note: note(1, 'a') },
      { opId: 'O1', status: 'created', note: note(1, 'a'), replayed: true },
    ]);
  });

  it('[S20] an empty batch returns no results', async () => {
    expect(await processBatch(store, [])).toEqual([]);
  });

  it('[S21] queries do not change anything', async () => {
    await send(op('O1', 0, 'a'));

    expect(await store.getNote('N')).toEqual(note(1, 'a'));
    expect(await store.getNote('N')).toEqual(note(1, 'a'));
    expect(await store.getNote('MISSING')).toBeNull();
    expect(await store.getReceipt('MISSING')).toBeNull();
  });
});

/**
 * Simulates "another transaction committed between my read and my write":
 * the first reads return stale values, while the real store holds the newer state.
 */
function withStaleReads(
  target: SyncStore,
  stale: { notes?: (Note | null)[]; receipts?: (Receipt | null)[] },
): { store: SyncStore; attempts: () => number } {
  const staleNotes = [...(stale.notes ?? [])];
  const staleReceipts = [...(stale.receipts ?? [])];
  let attempts = 0;

  const racy: SyncStore = {
    getNote: (noteId) => target.getNote(noteId),
    getReceipt: (opId) => target.getReceipt(opId),
    transaction: (work) => {
      attempts++;
      return target.transaction((tx) => {
        const wrapped: SyncTransaction = {
          findNote: async (noteId) => {
            const next = staleNotes.shift();
            return next !== undefined ? next : tx.findNote(noteId);
          },
          findReceipt: async (opId) => {
            const next = staleReceipts.shift();
            return next !== undefined ? next : tx.findReceipt(opId);
          },
          insertNote: (value) => tx.insertNote(value),
          updateNote: (value, expectedRevision) => tx.updateNote(value, expectedRevision),
          insertReceipt: (receipt) => tx.insertReceipt(receipt),
        };
        return work(wrapped);
      });
    },
  };
  return { store: racy, attempts: () => attempts };
}

describe('processBatch: retry after a lost race (ADR 0006)', () => {
  beforeEach(async () => {
    await send(op('O1', 0, 'a'));
    await send(op('O2', 1, 'competitor')); // N is now at revision 2
  });

  it('lost the note CAS: decides again and returns a conflict', async () => {
    const racy = withStaleReads(store, { notes: [note(1, 'a')] });

    expect(await send(op('O3', 1, 'mine'), racy.store)).toMatchObject({
      status: 'conflict',
      server: note(2, 'competitor'),
    });
    expect(racy.attempts()).toBe(2);
    expect(await store.getNote('N')).toEqual(note(2, 'competitor'));
  });

  it('lost the receipt insert to a copy of the same operation: returns the replay', async () => {
    const racy = withStaleReads(store, { receipts: [null] });

    expect(await send(op('O2', 1, 'competitor'), racy.store)).toMatchObject({
      status: 'updated',
      replayed: true,
    });
    expect(racy.attempts()).toBe(2);
  });

  it('worst case settles on the last allowed attempt', async () => {
    const racy = withStaleReads(store, { notes: [note(1, 'a')], receipts: [null, null] });

    expect(await send(op('O2', 1, 'competitor'), racy.store)).toMatchObject({ replayed: true });
    expect(racy.attempts()).toBe(MAX_ATTEMPTS);
  });

  it('gives up after MAX_ATTEMPTS and leaves no partial writes', async () => {
    const forever = Array.from({ length: MAX_ATTEMPTS }, () => note(1, 'a'));
    const racy = withStaleReads(store, { notes: forever });

    await expect(send(op('O3', 1, 'mine'), racy.store)).rejects.toBeInstanceOf(RetriesExhaustedError);
    expect(await store.getReceipt('O3')).toBeNull();
    expect(await store.getNote('N')).toEqual(note(2, 'competitor'));
  });

  it('propagates infrastructure failures instead of turning them into results', async () => {
    const broken: SyncStore = {
      getNote: (noteId) => store.getNote(noteId),
      getReceipt: (opId) => store.getReceipt(opId),
      transaction: () => Promise.reject(new Error('database is down')),
    };

    await expect(processBatch(broken, [op('O9', 0, 'a')])).rejects.toThrow('database is down');
  });
});
