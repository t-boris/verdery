import { describe, expect, it } from 'vitest';
import { generateDerivativeObjectKey } from './derivative-object-key.js';

const SOURCE_MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d00';

describe('generateDerivativeObjectKey', () => {
  it('produces the documented <shard>/<sourceMediaId>/<objectUuid> shape', () => {
    const key = generateDerivativeObjectKey(SOURCE_MEDIA_ID);
    const [shard, mediaId, objectUuid] = key.split('/');

    expect(shard).toMatch(/^[0-9a-f]{2}$/u);
    expect(mediaId).toBe(SOURCE_MEDIA_ID);
    expect(objectUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
  });

  it('is deterministic in its shard for the same source media id, across calls', () => {
    const first = generateDerivativeObjectKey(SOURCE_MEDIA_ID).split('/')[0];
    const second = generateDerivativeObjectKey(SOURCE_MEDIA_ID).split('/')[0];
    expect(first).toBe(second);
  });

  it('generates a fresh object uuid on every call, never reusing an object key', () => {
    const keys = new Set(
      Array.from({ length: 20 }, () => generateDerivativeObjectKey(SOURCE_MEDIA_ID)),
    );
    expect(keys.size).toBe(20);
  });
});
