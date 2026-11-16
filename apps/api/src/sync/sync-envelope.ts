import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { z } from 'zod';

/** ADR 0004: batch processing is sequential, so latency grows with batch size. */
export const MAX_BATCH_SIZE = 100;

/**
 * Only the envelope is validated here. Each operation is validated by the core,
 * because one invalid operation must not reject the whole batch (R9, ADR 0008).
 */
const envelopeSchema = z.object({ operations: z.array(z.unknown()) });

export function parseEnvelope(body: unknown): readonly unknown[] {
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Body must be { "operations": [...] }',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const { operations } = parsed.data;
  if (operations.length > MAX_BATCH_SIZE) {
    throw new PayloadTooLargeException(
      `A batch accepts at most ${MAX_BATCH_SIZE} operations, got ${operations.length}`,
    );
  }
  return operations;
}
