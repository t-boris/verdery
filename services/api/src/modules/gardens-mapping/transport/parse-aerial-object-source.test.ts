import { describe, expect, it } from 'vitest';
import { parseAerialObjectSourceMetadata } from './parse-aerial-object-source.js';

const metadata = {
  kind: 'aerialImageExtraction',
  proposalId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  processor: 'aerial-trace',
  model: 'vision-model',
  promptTemplateVersion: 1,
  boundaryEvidence: 'visualEvidence',
  limitations: ['Approximate visual boundary.'],
  imagery: {
    providerKey: 'usgs-naip',
    providerName: 'USGS NAIP',
    sourceId: 'source-1',
    capturedOn: '2025-06-01',
    attributionText: 'USDA NAIP',
    attributionUrl: 'https://example.com/source',
    licenseName: 'Public domain',
    licenseUrl: 'https://example.com/license',
  },
  imageryBounds: { west: -94, south: 41, east: -93, north: 42 },
  imageryWidthPixels: 1024,
  imageryHeightPixels: 1024,
  imageryResolutionMetres: 0.6,
  imageryHorizontalAccuracyMetres: 6,
  georeferenceRevision: 3,
} as const;

describe('parseAerialObjectSourceMetadata', () => {
  it('accepts the complete durable lineage shape', () => {
    expect(parseAerialObjectSourceMetadata(metadata, '/source/metadata')).toEqual(metadata);
  });

  it('rejects unusable imagery resolution', () => {
    expect(() =>
      parseAerialObjectSourceMetadata(
        { ...metadata, imageryResolutionMetres: 0 },
        '/source/metadata',
      ),
    ).toThrow(/greater than zero/u);
  });
});
