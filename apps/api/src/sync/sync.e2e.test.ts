import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InMemorySyncStore, MAX_TEXT_LENGTH } from '@offline-notes-sync/core';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule, configureApp } from '../app.module.js';
import { MAX_BATCH_SIZE } from './sync-envelope.js';

let app: INestApplication;

beforeEach(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(new InMemorySyncStore())],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
});

afterEach(() => app.close());

const http = () => request(app.getHttpServer());
const sync = (operations: unknown) => http().post('/sync').send({ operations });
const op = (opId: string, baseRevision: number, text: string) => ({
  opId,
  noteId: 'N',
  baseRevision,
  text,
});

describe('POST /sync', () => {
  it('[S1] the case scenario over HTTP', async () => {
    await sync([op('O1', 0, 'initial'), op('O2', 1, 'edit A')]).expect(200);

    const conflict = await sync([op('O3', 1, 'edit B')]).expect(200);
    expect(conflict.body.results[0]).toMatchObject({
      status: 'conflict',
      server: { revision: 2, text: 'edit A' },
      proposal: { baseRevision: 1, text: 'edit B' },
    });

    const replay = await sync([op('O2', 1, 'edit A')]).expect(200);
    expect(replay.body.results[0]).toMatchObject({ status: 'updated', replayed: true });

    await sync([op('O4', 2, 'A + B')]).expect(200);

    const oldReceipt = await sync([op('O3', 1, 'edit B')]).expect(200);
    expect(oldReceipt.body.results[0]).toMatchObject({ server: { revision: 2 }, replayed: true });

    const note = await http().get('/notes/N').expect(200);
    expect(note.body).toEqual({ id: 'N', text: 'A + B', revision: 3 });

    const reused = await sync([op('O2', 1, 'other text')]).expect(200);
    expect(reused.body.results[0]).toEqual({ opId: 'O2', status: 'id_reused' });
  });

  it('[S18] answers 200 with one result per operation, in order', async () => {
    const response = await sync([op('BAD', -1, 'x'), op('O1', 0, 'a'), op('O2', 0, 'b')]).expect(200);

    expect(response.body.results.map((result: { status: string }) => result.status)).toEqual([
      'invalid',
      'created',
      'conflict',
    ]);
  });

  it('[S20] an empty batch returns no results', async () => {
    const response = await sync([]).expect(200);

    expect(response.body).toEqual({ results: [] });
  });

  it.each([
    ['no operations field', {}],
    ['operations is not a list', { operations: 'nope' }],
    ['a list instead of an object', [op('O1', 0, 'a')]],
  ])('rejects a malformed envelope with 400: %s', async (_case, body) => {
    await http().post('/sync').send(body).expect(400);
  });

  it('rejects malformed JSON with 400', async () => {
    await http().post('/sync').set('Content-Type', 'application/json').send('{"operations":').expect(400);
  });

  it(`accepts exactly ${MAX_BATCH_SIZE} operations and rejects one more with 413`, async () => {
    const batch = (size: number) => Array.from({ length: size }, (_, i) => op(`O${i}`, 0, 'a'));

    await sync(batch(MAX_BATCH_SIZE)).expect(200);
    await sync(batch(MAX_BATCH_SIZE + 1)).expect(413);
  });

  it('accepts a text at the maximum length (above the 100kb default body limit)', async () => {
    const response = await sync([op('O1', 0, 'x'.repeat(MAX_TEXT_LENGTH))]).expect(200);

    expect(response.body.results[0]).toMatchObject({ status: 'created' });
  });
});

describe('GET endpoints', () => {
  it('[S21] GET /notes/:id returns 404, then the current note', async () => {
    await http().get('/notes/N').expect(404);
    await sync([op('O1', 0, 'a')]);

    const response = await http().get('/notes/N').expect(200);
    expect(response.body).toEqual({ id: 'N', text: 'a', revision: 1 });
  });

  it('GET /operations/:opId returns 404, then the stored receipt', async () => {
    await http().get('/operations/O1').expect(404);
    await sync([op('O1', 0, 'a')]);

    const response = await http().get('/operations/O1').expect(200);
    expect(response.body).toEqual({
      operation: op('O1', 0, 'a'),
      result: { opId: 'O1', status: 'created', note: { id: 'N', text: 'a', revision: 1 } },
    });
  });
});
