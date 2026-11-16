import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  processBatch,
  type Note,
  type OperationResult,
  type Receipt,
  type SyncStore,
} from '@offline-notes-sync/core';
import { parseEnvelope } from './sync-envelope.js';
import { SYNC_STORE } from './tokens.js';

/**
 * Driving adapter (ADR 0002): translates HTTP into calls to the core.
 * No sync rule lives here.
 */
@Controller()
export class SyncController {
  constructor(@Inject(SYNC_STORE) private readonly store: SyncStore) {}

  /** 200 even when operations fail: outcomes are per operation (ADR 0004, 0008). */
  @Post('sync')
  @HttpCode(200)
  async sync(@Body() body: unknown): Promise<{ results: OperationResult[] }> {
    return { results: await processBatch(this.store, parseEnvelope(body)) };
  }

  /** Current state of a note (R10). */
  @Get('notes/:id')
  async getNote(@Param('id') id: string): Promise<Note> {
    const note = await this.store.getNote(id);
    if (note === null) throw new NotFoundException(`Note ${id} not found`);
    return note;
  }

  /** Stored receipt of an operation, as recorded the first time. */
  @Get('operations/:opId')
  async getReceipt(@Param('opId') opId: string): Promise<Receipt> {
    const receipt = await this.store.getReceipt(opId);
    if (receipt === null) throw new NotFoundException(`Operation ${opId} not found`);
    return receipt;
  }
}
