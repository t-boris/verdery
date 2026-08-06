import { describe, expect, it } from 'vitest';

import type { WireAerialTraceProposal } from '@/core/api/public';

import { aerialProposalSource } from './use-map-editor-aerial-actions';

const proposal: WireAerialTraceProposal = {
  proposalId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  boundaryEvidence: 'notApplicable',
  category: 'tree',
  geometry: { type: 'Point', coordinates: [1, 2] },
  label: 'Oak',
  confidence: 0.87,
  limitations: ['Canopy obscures the trunk.'],
  provenance: {
    kind: 'imageExtraction',
    processor: 'aerial-trace',
    model: 'vision-model',
    promptTemplateVersion: 2,
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
  },
};

describe('aerialProposalSource', () => {
  it('keeps complete imagery, processor, transform, confidence, and limitation lineage', () => {
    const source = aerialProposalSource(proposal);

    expect(source.provenance).toBe('imageExtraction');
    expect(source.confidence).toBe(0.87);
    expect(source.metadata).toEqual(
      expect.objectContaining({
        kind: 'aerialImageExtraction',
        proposalId: proposal.proposalId,
        model: 'vision-model',
        limitations: proposal.limitations,
        imagery: proposal.provenance.imagery,
        georeferenceRevision: 3,
      }),
    );
  });
});
