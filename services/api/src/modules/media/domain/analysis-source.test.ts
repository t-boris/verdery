import { describe, expect, it } from 'vitest';

import { pickAnalysisSource, type AnalysisSourceCandidate } from './analysis-source.js';

const LIMIT = 31_457_280;

function candidate(bytes: number, key = 'object', mime = 'image/png'): AnalysisSourceCandidate {
  return {
    bucketName: 'bucket',
    objectKey: key,
    declaredContentType: mime,
    verifiedContentType: null,
    declaredByteSize: bytes,
    verifiedByteSize: null,
  };
}

describe('pickAnalysisSource', () => {
  it('uses the original when it fits and nothing else exists', () => {
    expect(pickAnalysisSource(candidate(1_000, 'original'), [], LIMIT)?.objectKey).toBe('original');
  });

  // Detail is what a species guess depends on, so among the objects that fit,
  // the biggest wins.
  it('prefers the largest object that fits', () => {
    const source = pickAnalysisSource(
      candidate(40_000_000, 'original'),
      [candidate(200_000, 'thumbnail'), candidate(4_000_000, 'display')],
      LIMIT,
    );

    expect(source?.objectKey).toBe('display');
  });

  it('keeps the original when it fits and is the largest', () => {
    const source = pickAnalysisSource(
      candidate(5_000_000, 'original'),
      [candidate(200_000, 'thumbnail')],
      LIMIT,
    );

    expect(source?.objectKey).toBe('original');
  });

  // The usual state right after an upload: derivatives are generated
  // asynchronously and do not exist yet. Returning the original lets the
  // caller report the size, which is a better answer than "no suggestion".
  it('falls back to the original when nothing fits', () => {
    const source = pickAnalysisSource(candidate(40_000_000, 'original'), [], LIMIT);

    expect(source?.objectKey).toBe('original');
    expect(source?.byteSize).toBe(40_000_000);
  });

  it('prefers verified type and size over what the client declared', () => {
    const source = pickAnalysisSource(
      {
        bucketName: 'bucket',
        objectKey: 'original',
        declaredContentType: 'image/png',
        verifiedContentType: 'image/jpeg',
        declaredByteSize: 999,
        verifiedByteSize: 1_234,
      },
      [],
      LIMIT,
    );

    expect(source?.mimeType).toBe('image/jpeg');
    expect(source?.byteSize).toBe(1_234);
  });

  it('returns nothing when the original has no stored location', () => {
    expect(
      pickAnalysisSource({ ...candidate(1_000), bucketName: null, objectKey: null }, [], LIMIT),
    ).toBeNull();
  });
});
