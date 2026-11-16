import { z } from 'zod';
import type { Invalid, Operation } from './types.js';

export const MAX_ID_LENGTH = 128;
export const MAX_TEXT_LENGTH = 100_000;

/**
 * Field rules for an operation (R5, A2, ADR 0008).
 * Unknown fields are stripped (z.object's default), so they never affect
 * the "same content" comparison (A1).
 */
export const operationSchema = z.object({
  opId: z.string().min(1).max(MAX_ID_LENGTH),
  noteId: z.string().min(1).max(MAX_ID_LENGTH),
  baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  text: z.string().max(MAX_TEXT_LENGTH),
});

export type ParseResult =
  | { readonly ok: true; readonly operation: Operation }
  | { readonly ok: false; readonly result: Invalid };

/** Validates an untrusted input. Pure: never touches storage (R5). */
export function parseOperation(input: unknown): ParseResult {
  const parsed = operationSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, operation: parsed.data };
  }
  return {
    ok: false,
    result: {
      opId: readOpId(input),
      status: 'invalid',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  };
}

/** Best-effort `opId` so the client can match the error to its operation. */
function readOpId(input: unknown): string | null {
  if (typeof input === 'object' && input !== null && 'opId' in input) {
    const { opId } = input;
    return typeof opId === 'string' ? opId : null;
  }
  return null;
}
