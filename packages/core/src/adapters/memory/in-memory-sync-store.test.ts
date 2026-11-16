import { describe, expect, it } from 'vitest';
import type { SyncTransaction } from '../../application/sync-store.js';
import { describeSyncStoreContract } from '../../testing/sync-store-contract.js';
import { InMemorySyncStore } from './in-memory-sync-store.js';

describeSyncStoreContract('in-memory', () => new InMemorySyncStore());

describe('InMemorySyncStore: isolation', () => {
  it('runs one transaction at a time, even across awaits', async () => {
    const store = new InMemorySyncStore();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = store.transaction(async () => {
      events.push('first:start');
      await gate;
      events.push('first:end');
    });
    const second = store.transaction(async () => {
      events.push('second:start');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['first:start']);

    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('keeps working after a failed transaction', async () => {
    const store = new InMemorySyncStore();

    await expect(store.transaction(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    expect(await store.transaction(async () => 'ok')).toBe('ok');
  });

  it('refuses a transaction handle used after the transaction finished', async () => {
    const store = new InMemorySyncStore();
    let leaked!: SyncTransaction;

    await store.transaction(async (tx) => {
      leaked = tx;
    });

    await expect(leaked.findNote('N')).rejects.toThrow('Transaction already finished');
  });
});
