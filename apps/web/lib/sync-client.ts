import type { Note, Operation, OperationResult } from '@offline-notes-sync/core';

/** Same-origin calls; next.config.ts rewrites /api/* to the Sync API (ADR 0011). */
const API = '/api';

export async function postSync(operations: readonly Operation[]): Promise<OperationResult[]> {
  const response = await fetch(`${API}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operations }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { results: OperationResult[] };
  return body.results;
}

export async function fetchNote(noteId: string): Promise<Note | null> {
  const response = await fetch(`${API}/notes/${encodeURIComponent(noteId)}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as Note;
}
