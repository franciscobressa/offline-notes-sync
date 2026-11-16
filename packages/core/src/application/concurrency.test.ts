import { beforeEach, describe, expect, it } from 'vitest';
import { InMemorySyncStore } from '../adapters/memory/in-memory-sync-store.js';
import type { Operation, OperationResult } from '../domain/types.js';
import { processBatch, processOperation } from './process-batch.js';

/**
 * Concurrent requests against the in-memory store (C1–C3).
 * Node runs on one thread, but async/await interleaves transactions at every
 * `await`. Without the store's mutex, two transactions would read the same
 * revision and both write: these tests fail if the mutex is removed (ADR 0009).
 */
const CONCURRENCY = 20;

const op = (opId: string, baseRevision: number, text: string): Operation => ({
  opId,
  noteId: 'N',
  baseRevision,
  text,
});

const isReplay = (result: OperationResult): boolean => 'replayed' in result;

let store: InMemorySyncStore;

/** Fires every operation at once; each one runs in its own transaction. */
const race = (operations: Operation[]) =>
  Promise.all(operations.map((operation) => processOperation(store, operation)));

beforeEach(() => {
  store = new InMemorySyncStore();
});

describe(`concurrency: ${CONCURRENCY} simultaneous requests`, () => {
  it('[C1] copies of the same operation apply it exactly once', async () => {
    await processBatch(store, [op('O1', 0, 'a')]);
    const copy = op('O2', 1, 'b');

    const results = await race(Array.from({ length: CONCURRENCY }, () => copy));

    expect(results.filter((result) => !isReplay(result))).toEqual([
      { opId: 'O2', status: 'updated', note: { id: 'N', text: 'b', revision: 2 } },
    ]);
    expect(results.filter(isReplay)).toHaveLength(CONCURRENCY - 1);
    expect(await store.getNote('N')).toEqual({ id: 'N', text: 'b', revision: 2 });
  });

  it('[C2] different edits on the same base: one wins, the rest conflict', async () => {
    await processBatch(store, [op('O1', 0, 'a')]);
    const edits = Array.from({ length: CONCURRENCY }, (_, i) => op(`E${i}`, 1, `text ${i}`));

    const results = await race(edits);
    const winners = results.filter((result) => result.status === 'updated');

    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === 'conflict')).toHaveLength(CONCURRENCY - 1);
    const winner = winners[0];
    expect(await store.getNote('N')).toEqual(winner?.status === 'updated' ? winner.note : 'no winner');
  });

  it('[C3] creations of the same note: one creates, the rest conflict', async () => {
    const creations = Array.from({ length: CONCURRENCY }, (_, i) => op(`C${i}`, 0, `text ${i}`));

    const results = await race(creations);

    expect(results.filter((result) => result.status === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'conflict')).toHaveLength(CONCURRENCY - 1);
    expect(await store.getNote('N')).toMatchObject({ revision: 1 });
  });
});
