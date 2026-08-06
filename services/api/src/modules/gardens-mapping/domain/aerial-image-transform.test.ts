import { describe, expect, it } from 'vitest';

import type { Georeference } from '../application/georeference-repository.js';
import {
  aerialTransformUsable,
  buildAerialProposalGeometry,
  normalizedImagePointToLocal,
} from './aerial-image-transform.js';

const georeference: Georeference = {
  id: '01911111-1111-7111-8111-111111111111',
  gardenId: '01922222-2222-7222-8222-222222222222',
  coordinateSpaceId: '01933333-3333-7333-8333-333333333333',
  localAnchor: [10, 20],
  geographicAnchor: [-87.65, 41.88],
  rotationDegrees: 0,
  scaleCorrection: 1,
  accuracyMetres: 3,
  provenance: 'externalProvider',
  method: 'addressSearch',
  revision: 2,
};

const source = {
  bounds: { west: -87.651, south: 41.879, east: -87.649, north: 41.881 },
  groundResolutionMetres: 0.3,
  widthPixels: 1024,
  heightPixels: 1024,
};

describe('aerial image transform', () => {
  it('maps image centre to the garden anchor and preserves north-up orientation', () => {
    const centre = normalizedImagePointToLocal([0.5, 0.5], source.bounds, georeference);
    expect(centre?.[0]).toBeCloseTo(10, 8);
    expect(centre?.[1]).toBeCloseTo(20, 8);
    const top = normalizedImagePointToLocal([0.5, 0], source.bounds, georeference);
    expect(top?.[1]).toBeGreaterThan(20);
  });

  it('applies the same georeference rotation used by the map backdrop', () => {
    const east = normalizedImagePointToLocal([0.75, 0.5], source.bounds, {
      ...georeference,
      rotationDegrees: 90,
    });
    expect(east?.[0]).toBeCloseTo(10, 3);
    expect(east?.[1]).toBeLessThan(20);
  });

  it('rejects an image whose resolution or georeference accuracy is unusable', () => {
    expect(aerialTransformUsable(source, georeference)).toBe(true);
    expect(aerialTransformUsable({ ...source, groundResolutionMetres: 1.1 }, georeference)).toBe(
      false,
    );
    expect(aerialTransformUsable(source, { ...georeference, accuracyMetres: 30 })).toBe(false);
  });

  it('builds category-compatible polygon, line, and point proposals', () => {
    const polygon = buildAerialProposalGeometry(
      {
        category: 'structure',
        label: 'House',
        points: [
          [0.4, 0.4],
          [0.6, 0.4],
          [0.6, 0.6],
          [0.4, 0.6],
        ],
        confidence: 0.9,
        limitations: ['Tree shadow obscures one corner.'],
        boundaryEvidence: 'notApplicable',
      },
      source.bounds,
      georeference,
    );
    const line = buildAerialProposalGeometry(
      {
        category: 'path',
        label: 'Driveway',
        points: [
          [0.1, 0.2],
          [0.8, 0.7],
        ],
        confidence: 0.8,
        limitations: [],
        boundaryEvidence: 'notApplicable',
      },
      source.bounds,
      georeference,
    );
    const point = buildAerialProposalGeometry(
      {
        category: 'tree',
        label: 'Tree',
        points: [[0.2, 0.3]],
        confidence: 0.7,
        limitations: ['Trunk is partly hidden by canopy.'],
        boundaryEvidence: 'notApplicable',
      },
      source.bounds,
      georeference,
    );

    expect(polygon?.geometry.type).toBe('Polygon');
    expect(line?.geometry.type).toBe('LineString');
    expect(point?.geometry.type).toBe('Point');
  });

  it('omits a lot without explicit evidence and limitations', () => {
    const lot = {
      category: 'lot' as const,
      label: 'Approximate lot',
      points: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ] as const,
      confidence: 0.5,
      limitations: [] as readonly string[],
      boundaryEvidence: 'visualEvidence' as const,
    };
    expect(buildAerialProposalGeometry(lot, source.bounds, georeference)).toBeNull();
    expect(
      buildAerialProposalGeometry(
        { ...lot, limitations: ['Fence is hidden behind the house.'] },
        source.bounds,
        georeference,
      ),
    ).not.toBeNull();
  });
});
