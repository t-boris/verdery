import type { PlatReading } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlatReadingPanel } from './plat-reading-panel';
import type { MapEditorActions } from './use-map-editor-actions';

/** A reading of the Cascade Way plat: a lot that closes, a house, and a drive. */
function reading(overrides: Partial<PlatReading> = {}): PlatReading {
  return {
    isPlat: true,
    address: '7612 CASCADE WAY, GURNEE, IL 60031',
    northRotationDegrees: 0,
    statedAreaSquareFeet: 10_068,
    boundaryCalls: [],
    boundary: {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [30, 0],
            [30, 31],
            [0, 31],
            [0, 0],
          ],
        ],
      },
      closureErrorMetres: 0.42,
      closes: true,
      areaSquareMetres: 934,
    },
    objects: [
      {
        category: 'structure',
        label: '2 STORY FRAME #7612',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [8, 10],
              [18, 10],
              [18, 20],
              [8, 20],
              [8, 10],
            ],
          ],
        },
        confidence: 0.8,
        areaSquareMetres: 100,
      },
      {
        category: 'path',
        label: 'ASPHALT DRIVE',
        geometry: {
          type: 'LineString',
          coordinates: [
            [4, 0],
            [4, 10],
          ],
        },
        confidence: 0.7,
        areaSquareMetres: 0,
      },
    ],
    pageFitResidualMetres: 0.31,
    ...overrides,
  };
}

function renderPanel(reviewed: PlatReading, acceptPlatProposals = vi.fn().mockResolvedValue(3)) {
  const onDismiss = vi.fn();
  render(
    <LocalizationProvider locale="en">
      <PlatReadingPanel
        reading={reviewed}
        actions={{ acceptPlatProposals } as unknown as MapEditorActions}
        onDismiss={onDismiss}
      />
    </LocalizationProvider>,
  );
  return { acceptPlatProposals, onDismiss };
}

describe('PlatReadingPanel', () => {
  it('shows what the survey checks itself with, not only the shapes', () => {
    renderPanel(reading());

    expect(screen.getByText('7612 CASCADE WAY, GURNEE, IL 60031')).toBeDefined();
    expect(screen.getByText('Closes to 0.42 m')).toBeDefined();
    // The sheet's own area next to the walked one is the check a surveyor
    // would make: agreement within a percent means every call was read right.
    expect(screen.getByText(/sheet states 10,068 sq ft/)).toBeDefined();
    expect(screen.getByText(/within 0.31 m/)).toBeDefined();
  });

  it('accepts the boundary and every object by default, and creates them as objects', async () => {
    const { acceptPlatProposals, onDismiss } = renderPanel(reading());

    fireEvent.click(screen.getByRole('button', { name: 'Add 3 to the map' }));
    await vi.waitFor(() => {
      expect(acceptPlatProposals).toHaveBeenCalledWith(expect.anything(), [0, 1], true);
    });
    await vi.waitFor(() => {
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  it('leaves out an object the reviewer unchecked', async () => {
    const { acceptPlatProposals } = renderPanel(reading());

    fireEvent.click(screen.getByRole('checkbox', { name: /ASPHALT DRIVE/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 to the map' }));

    await vi.waitFor(() => {
      expect(acceptPlatProposals).toHaveBeenCalledWith(expect.anything(), [0], true);
    });
  });

  /*
   * A boundary that does not close is the wrong shape. It is still shown —
   * the person decides — but it is not pre-accepted, and the reason is on
   * screen next to the checkbox rather than buried.
   */
  it('does not pre-accept a boundary that does not close, and says why', () => {
    renderPanel(
      reading({
        boundary: {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [30, 0],
                [30, 31],
                [0, 0],
              ],
            ],
          },
          closureErrorMetres: 6.2,
          closes: false,
          areaSquareMetres: 500,
        },
      }),
    );

    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Lot boundary/ }).checked).toBe(
      false,
    );
    expect(screen.getByText(/does not close/)).toBeDefined();
  });

  it('answers plainly when the page is not a plat at all', () => {
    renderPanel(reading({ isPlat: false, boundary: null, objects: [] }));

    expect(screen.getByText(/not a plat of survey/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
  });
});
