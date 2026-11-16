'use client';

import type { Note, Operation, OperationResult } from '@offline-notes-sync/core';
import { useCallback, useEffect, useState } from 'react';
import {
  addLog,
  applyResults,
  createDevice,
  editDraft,
  editManually,
  keepMine,
  keepServer,
  markSent,
  pull,
  save,
  setOnline,
  type DeviceState,
} from '../lib/device';
import { fetchNote, postSync } from '../lib/sync-client';
import { DevicePanel } from './device-panel';

type DeviceKey = 'a' | 'b';
type ServerView = Note | null | 'unreachable';

interface Exchange {
  readonly from: string;
  readonly sent: readonly Operation[];
  readonly response: readonly OperationResult[] | string;
}

const freshDevices = (): Record<DeviceKey, DeviceState> => ({
  a: createDevice("Ana's phone"),
  b: createDevice("Bruno's laptop"),
});

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function Simulator() {
  const [noteId, setNoteId] = useState('shopping-list');
  const [devices, setDevices] = useState(freshDevices);
  const [server, setServer] = useState<ServerView>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);

  const update = useCallback((key: DeviceKey, change: (state: DeviceState) => DeviceState) => {
    setDevices((previous) => ({ ...previous, [key]: change(previous[key]) }));
  }, []);

  const refreshServer = useCallback(async () => {
    try {
      setServer(await fetchNote(noteId));
    } catch {
      setServer('unreachable');
    }
  }, [noteId]);

  useEffect(() => {
    void refreshServer();
  }, [refreshServer]);

  async function send(key: DeviceKey, operations: readonly Operation[], onResults: (results: OperationResult[]) => (state: DeviceState) => DeviceState) {
    const from = devices[key].name;
    try {
      const results = await postSync(operations);
      setExchange({ from, sent: operations, response: results });
      update(key, onResults(results));
    } catch (error) {
      setExchange({ from, sent: operations, response: message(error) });
      update(key, (state) => addLog(state, `network error (${message(error)}): the queue stays`));
    }
    await refreshServer();
  }

  async function sync(key: DeviceKey, loseResponse: boolean) {
    const current = devices[key];
    if (!current.online || current.queue.length === 0) return;
    const { operations } = markSent(current);
    update(key, (state) => markSent(state).state);
    await send(key, operations, (results) =>
      loseResponse
        ? (state) => addLog(state, 'response lost: the queue stays, the next sync resends the same opIds')
        : (state) => applyResults(state, results),
    );
  }

  async function resendLast(key: DeviceKey) {
    const current = devices[key];
    if (!current.online || current.lastBatch.length === 0) return;
    await send(key, current.lastBatch, (results) => (state) =>
      applyResults(addLog(state, 'resent the last batch'), results),
    );
  }

  async function pullFrom(key: DeviceKey) {
    try {
      const note = await fetchNote(noteId);
      update(key, (state) => pull(state, note));
    } catch (error) {
      update(key, (state) => addLog(state, `network error (${message(error)})`));
    }
    await refreshServer();
  }

  function newNote() {
    setNoteId(`note-${crypto.randomUUID().slice(0, 8)}`);
    setDevices(freshDevices());
    setExchange(null);
  }

  const panel = (key: DeviceKey) => (
    <DevicePanel
      state={devices[key]}
      onDraft={(text) => update(key, (state) => editDraft(state, text))}
      onSave={() => update(key, (state) => save(state, noteId, crypto.randomUUID()))}
      onToggleOnline={() => update(key, (state) => setOnline(state, !state.online))}
      onSync={() => void sync(key, false)}
      onSyncLoseResponse={() => void sync(key, true)}
      onPull={() => void pullFrom(key)}
      onResend={() => void resendLast(key)}
      onKeepServer={() => update(key, keepServer)}
      onKeepMine={() => update(key, (state) => keepMine(state, crypto.randomUUID()))}
      onEditManually={() => update(key, editManually)}
    />
  );

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Offline Notes Sync</h1>
          <p className="subtitle">
            Two devices edit the same note while offline. The server accepts safe edits, reports
            conflicts instead of overwriting, and turns resends into harmless replays.
          </p>
        </div>
        <div className="note-id">
          <span>
            Note <code>{noteId}</code>
          </span>
          <button type="button" onClick={newNote}>
            New note
          </button>
        </div>
      </header>

      <div className="grid">
        {panel('a')}
        <ServerPanel server={server} exchange={exchange} onRefresh={() => void refreshServer()} />
        {panel('b')}
      </div>
    </main>
  );
}

function ServerPanel({
  server,
  exchange,
  onRefresh,
}: {
  server: ServerView;
  exchange: Exchange | null;
  onRefresh: () => void;
}) {
  return (
    <section className="card server">
      <header className="card-header">
        <h2>Server</h2>
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
      </header>

      {server === 'unreachable' ? (
        <p className="muted">
          API unreachable. Start it with <code>npm run start:api</code>.
        </p>
      ) : server === null ? (
        <p className="muted">This note does not exist on the server yet.</p>
      ) : (
        <div className="server-note">
          <span className="badge">rev {server.revision}</span>
          <p className="note-text">{server.text || <em className="muted">(empty)</em>}</p>
        </div>
      )}

      <h3>Last exchange</h3>
      {exchange === null ? (
        <p className="muted">Nothing sent yet.</p>
      ) : (
        <div className="exchange">
          <p className="muted">from {exchange.from}</p>
          <pre>{JSON.stringify({ operations: exchange.sent }, null, 2)}</pre>
          <pre>
            {typeof exchange.response === 'string'
              ? exchange.response
              : JSON.stringify({ results: exchange.response }, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
