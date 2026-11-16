import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH, MAX_TEXT_LENGTH, parseOperation } from './parse-operation.js';

const valid = { opId: 'O1', noteId: 'N', baseRevision: 0, text: 'a' };

describe('parseOperation: valid input', () => {
  it('accepts a well-formed operation', () => {
    expect(parseOperation(valid)).toEqual({ ok: true, operation: valid });
  });

  it('[S4] accepts an empty text', () => {
    expect(parseOperation({ ...valid, text: '' }).ok).toBe(true);
  });

  it('[S13] strips unknown fields so they never count as content', () => {
    expect(parseOperation({ ...valid, extra: true })).toEqual({ ok: true, operation: valid });
  });

  it('[S12] accepts values exactly at the limits', () => {
    const atLimit = {
      opId: 'o'.repeat(MAX_ID_LENGTH),
      noteId: 'n'.repeat(MAX_ID_LENGTH),
      baseRevision: Number.MAX_SAFE_INTEGER,
      text: 't'.repeat(MAX_TEXT_LENGTH),
    };

    expect(parseOperation(atLimit).ok).toBe(true);
  });
});

describe('parseOperation: invalid input', () => {
  it.each([
    ['missing opId', { ...valid, opId: undefined }],
    ['empty opId', { ...valid, opId: '' }],
    ['opId over the limit', { ...valid, opId: 'o'.repeat(MAX_ID_LENGTH + 1) }],
    ['missing noteId', { ...valid, noteId: undefined }],
    ['numeric noteId', { ...valid, noteId: 42 }],
    ['negative baseRevision', { ...valid, baseRevision: -1 }],
    ['fractional baseRevision', { ...valid, baseRevision: 1.5 }],
    ['string baseRevision', { ...valid, baseRevision: '1' }],
    ['baseRevision above MAX_SAFE_INTEGER', { ...valid, baseRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ['missing text', { ...valid, text: undefined }],
    ['null text', { ...valid, text: null }],
    ['text over the limit', { ...valid, text: 't'.repeat(MAX_TEXT_LENGTH + 1) }],
    ['null instead of an object', null],
    ['number instead of an object', 42],
    ['array instead of an object', [valid]],
  ])('[S12] rejects %s', (_case, input) => {
    const parsed = parseOperation(input);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.result.status).toBe('invalid');
      expect(parsed.result.errors.length).toBeGreaterThan(0);
    }
  });

  it('reports every problem at once, with the field path', () => {
    const parsed = parseOperation({ ...valid, noteId: '', baseRevision: -1 });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.result.errors.map((error) => error.path).sort()).toEqual([
        'baseRevision',
        'noteId',
      ]);
    }
  });

  it('echoes the opId when it is a string, so the client can match the error', () => {
    const parsed = parseOperation({ ...valid, baseRevision: -1 });

    expect(parsed).toMatchObject({ ok: false, result: { opId: 'O1' } });
  });

  it('uses opId: null when the input has no usable opId', () => {
    expect(parseOperation({ ...valid, opId: 7 })).toMatchObject({ ok: false, result: { opId: null } });
    expect(parseOperation(null)).toMatchObject({ ok: false, result: { opId: null } });
  });
});
