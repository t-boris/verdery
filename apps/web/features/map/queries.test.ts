import type { MapCommandPayload } from '@verdery/geometry-contracts';
import { describe, expect, it } from 'vitest';

import type { MapDocumentData } from './queries';
import { withCurrentMapRevisions } from './queries';

const document: MapDocumentData = {
  coordinateSpaceId: 'local',
  validationSummary: [],
  objects: [
    {
      id: 'first',
      gardenId: 'garden',
      category: 'plant',
      geometry: { type: 'Point', coordinates: [0, 0] },
      lifecycleState: 'active',
      isHidden: false,
      isLocked: false,
      revision: 7,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'second',
      gardenId: 'garden',
      category: 'path',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
      lifecycleState: 'active',
      isHidden: false,
      isLocked: false,
      revision: 11,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('withCurrentMapRevisions', () => {
  it('rebases a queued object command onto the latest cached server revision', () => {
    const command: MapCommandPayload = {
      type: 'moveObject',
      objectId: 'first',
      expectedRevision: 1,
      translationMetres: { dx: 1, dy: 2 },
    };
    expect(withCurrentMapRevisions(command, document)).toMatchObject({ expectedRevision: 7 });
  });

  it('rebases both source revisions for a queued join', () => {
    const command: MapCommandPayload = {
      type: 'joinLinework',
      firstObjectId: 'first',
      firstExpectedRevision: 1,
      secondObjectId: 'second',
      secondExpectedRevision: 1,
      resultObjectId: 'result',
    };
    expect(withCurrentMapRevisions(command, document)).toMatchObject({
      firstExpectedRevision: 7,
      secondExpectedRevision: 11,
    });
  });
});
