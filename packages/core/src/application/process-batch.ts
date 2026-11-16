import { decide } from '../domain/decide.js';
import { parseOperation } from '../domain/parse-operation.js';
import type { Decision, Operation, OperationResult } from '../domain/types.js';
import type { SyncStore, SyncTransaction } from './sync-store.js';

/**
 * Worst case is 3 attempts (ADR 0006): the note CAS loses, then the receipt insert
 * loses to a copy of the same operation, then the receipt is found and replayed.
 */
export const MAX_ATTEMPTS = 3;

/** Thrown when the retry limit is hit. Reaching it means a bug, not contention. */
export class RetriesExhaustedError extends Error {
  constructor(readonly opId: string) {
    super(`Operation ${opId} did not settle after ${MAX_ATTEMPTS} attempts`);
    this.name = 'RetriesExhaustedError';
  }
}

/** Internal signal: a conditional write lost a race, so roll back and decide again. */
class LostRaceError extends Error {}

/**
 * Processes a batch in order, one result per input (R9). Each operation runs in
 * its own transaction, so a conflict or invalid input never affects the others.
 * Infrastructure failures are thrown, not returned: they are not protocol outcomes.
 */
export async function processBatch(
  store: SyncStore,
  inputs: readonly unknown[],
): Promise<OperationResult[]> {
  const results: OperationResult[] = [];
  for (const input of inputs) {
    const parsed = parseOperation(input); // R5: before any read or write
    results.push(parsed.ok ? await processOperation(store, parsed.operation) : parsed.result);
  }
  return results;
}

export async function processOperation(
  store: SyncStore,
  operation: Operation,
): Promise<OperationResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await store.transaction(async (tx) => {
        const receipt = await tx.findReceipt(operation.opId);
        const note = await tx.findNote(operation.noteId);
        return apply(tx, decide(operation, receipt, note));
      });
    } catch (error) {
      if (!(error instanceof LostRaceError)) throw error;
      // The transaction was rolled back; `decide` is pure, so running it again is safe.
    }
  }
  throw new RetriesExhaustedError(operation.opId);
}

async function apply(tx: SyncTransaction, decision: Decision): Promise<OperationResult> {
  switch (decision.kind) {
    case 'replay':
    case 'reject':
      return decision.result; // nothing is written (A8)
    case 'create':
      await mustWrite(tx.insertNote(decision.note));
      break;
    case 'update':
      await mustWrite(tx.updateNote(decision.note, decision.expectedRevision));
      break;
    case 'conflict':
      break; // the note is left untouched (R4)
    default:
      return assertNever(decision);
  }
  await mustWrite(tx.insertReceipt(decision.receipt)); // R6: same commit as the effect
  return decision.receipt.result;
}

async function mustWrite(write: Promise<boolean>): Promise<void> {
  if (!(await write)) throw new LostRaceError();
}

function assertNever(value: never): never {
  throw new Error(`Unhandled decision: ${JSON.stringify(value)}`);
}
