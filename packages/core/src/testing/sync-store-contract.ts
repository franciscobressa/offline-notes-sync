import { beforeEach, describe, expect, it } from 'vitest';
import type { SyncStore } from '../application/sync-store.js';
import type { Note, Receipt } from '../domain/types.js';

const note = (revision: number, text = 'a'): Note => ({ id: 'N', text, revision });

const createdReceipt = (opId: string, text = 'a'): Receipt => ({
  operation: { opId, noteId: 'N', baseRevision: 0, text },
  result: { opId, status: 'created', note: note(1, text) },
});

/**
 * Behaviour every SyncStore adapter must have (ADR 0002, 0012).
 * Any future adapter (a database, for example) must pass this same suite (ADR 0009).
 */
export function describeSyncStoreContract(
  name: string,
  createStore: () => SyncStore | Promise<SyncStore>,
): void {
  describe(`SyncStore contract: ${name}`, () => {
    let store: SyncStore;

    beforeEach(async () => {
      store = await createStore();
    });

    const seedNote = (value: Note): Promise<boolean> =>
      store.transaction((tx) => tx.insertNote(value));

    it('[R1] starts empty', async () => {
      expect(await store.getNote('N')).toBeNull();
      expect(await store.getReceipt('O1')).toBeNull();
    });

    it('commits every write when the work resolves', async () => {
      await store.transaction(async (tx) => {
        expect(await tx.insertNote(note(1))).toBe(true);
        expect(await tx.insertReceipt(createdReceipt('O1'))).toBe(true);
      });

      expect(await store.getNote('N')).toEqual(note(1));
      expect(await store.getReceipt('O1')).toEqual(createdReceipt('O1'));
    });

    it('rolls back every write and rethrows when the work throws', async () => {
      const failure = new Error('boom');

      await expect(
        store.transaction(async (tx) => {
          await tx.insertNote(note(1));
          await tx.insertReceipt(createdReceipt('O1'));
          throw failure;
        }),
      ).rejects.toBe(failure);

      expect(await store.getNote('N')).toBeNull();
      expect(await store.getReceipt('O1')).toBeNull();
    });

    it('sees its own writes inside the transaction', async () => {
      await store.transaction(async (tx) => {
        await tx.insertNote(note(1));
        await tx.insertReceipt(createdReceipt('O1'));

        expect(await tx.findNote('N')).toEqual(note(1));
        expect(await tx.findReceipt('O1')).toEqual(createdReceipt('O1'));
      });
    });

    it('insertNote returns false when the note already exists', async () => {
      await seedNote(note(1));

      expect(await store.transaction((tx) => tx.insertNote(note(1, 'other')))).toBe(false);
      expect(await store.getNote('N')).toEqual(note(1));
    });

    it('updateNote is a compare-and-set on the revision', async () => {
      await seedNote(note(1));

      expect(await store.transaction((tx) => tx.updateNote(note(2, 'b'), 5))).toBe(false);
      expect(await store.getNote('N')).toEqual(note(1));

      expect(await store.transaction((tx) => tx.updateNote(note(2, 'b'), 1))).toBe(true);
      expect(await store.getNote('N')).toEqual(note(2, 'b'));
    });

    it('updateNote returns false for a missing note', async () => {
      expect(await store.transaction((tx) => tx.updateNote(note(2), 1))).toBe(false);
      expect(await store.getNote('N')).toBeNull();
    });

    it('insertReceipt returns false when the opId is taken, keeping the original', async () => {
      await store.transaction((tx) => tx.insertReceipt(createdReceipt('O1', 'a')));

      expect(await store.transaction((tx) => tx.insertReceipt(createdReceipt('O1', 'b')))).toBe(false);
      expect(await store.getReceipt('O1')).toEqual(createdReceipt('O1', 'a'));
    });

    it.each<[string, Receipt]>([
      [
        'a conflict on a missing note',
        {
          operation: { opId: 'O2', noteId: 'N', baseRevision: 3, text: 'x' },
          result: {
            opId: 'O2',
            status: 'conflict',
            server: null,
            proposal: { noteId: 'N', baseRevision: 3, text: 'x' },
          },
        },
      ],
      [
        'a conflict with server state',
        {
          operation: { opId: 'O3', noteId: 'N', baseRevision: 1, text: 'y' },
          result: {
            opId: 'O3',
            status: 'conflict',
            server: note(2, 'x'),
            proposal: { noteId: 'N', baseRevision: 1, text: 'y' },
          },
        },
      ],
      [
        'an update with unicode and an empty-looking text',
        {
          operation: { opId: 'O4', noteId: 'N', baseRevision: 1, text: ' ção 🚀 ' },
          result: { opId: 'O4', status: 'updated', note: note(2, ' ção 🚀 ') },
        },
      ],
    ])('returns %s receipt exactly as stored', async (_case, receipt) => {
      await store.transaction((tx) => tx.insertReceipt(receipt));

      expect(await store.getReceipt(receipt.operation.opId)).toEqual(receipt);
    });

    it('returns copies, so callers cannot change stored state', async () => {
      await seedNote(note(1));

      const read = (await store.getNote('N')) as { text: string };
      read.text = 'mutated';

      expect(await store.getNote('N')).toEqual(note(1));
    });
  });
}
