import { describe, expect, it } from 'vitest';
import { generateObjectKey, selectBucketName } from './media-storage-target.js';
import type { MediaStorageBucketNames } from './media-storage-target.js';

const BUCKETS: MediaStorageBucketNames = {
  userMedia: 'user-media-bucket',
  rawCapture: 'raw-capture-bucket',
  derived: 'derived-bucket',
  exports: 'exports-bucket',
};

describe('selectBucketName', () => {
  it('routes garden_photo and imported_plan to the user-media bucket', () => {
    expect(selectBucketName('garden_photo', BUCKETS)).toBe('user-media-bucket');
    expect(selectBucketName('imported_plan', BUCKETS)).toBe('user-media-bucket');
  });

  it('routes raw_capture to the raw-capture bucket', () => {
    expect(selectBucketName('raw_capture', BUCKETS)).toBe('raw-capture-bucket');
  });

  it('routes derived_preview and processing_output to the derived bucket', () => {
    expect(selectBucketName('derived_preview', BUCKETS)).toBe('derived-bucket');
    expect(selectBucketName('processing_output', BUCKETS)).toBe('derived-bucket');
  });

  it('routes export_package to the exports bucket', () => {
    expect(selectBucketName('export_package', BUCKETS)).toBe('exports-bucket');
  });
});

describe('generateObjectKey', () => {
  const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

  it('produces a <shard>/<mediaUuid>/<objectUuid> key with a two-character hex shard', () => {
    const key = generateObjectKey(MEDIA_ID);
    const segments = key.split('/');

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatch(/^[0-9a-f]{2}$/u);
    expect(segments[1]).toBe(MEDIA_ID);
    expect(segments[2]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('is deterministic in its shard for the same mediaId, but generates a fresh objectUuid every call', () => {
    const first = generateObjectKey(MEDIA_ID);
    const second = generateObjectKey(MEDIA_ID);

    const firstShard = first.split('/')[0];
    const secondShard = second.split('/')[0];
    expect(firstShard).toBe(secondShard);
    expect(first).not.toBe(second);
  });

  it('spreads shards across different media ids rather than clustering by UUIDv7 time-ordering', () => {
    // Two UUIDv7s minted moments apart share the same leading (timestamp)
    // hex characters — the exact hotspotting this shard scheme avoids by
    // hashing instead of slicing the id directly.
    const shardA = generateObjectKey('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b').split('/')[0];
    const shardB = generateObjectKey('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c').split('/')[0];
    expect(shardA).not.toBe(shardB);
  });
});
