import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WireAerialTracingResult } from '@/core/api/public';
import { LocalizationProvider } from '@/shared/localization/public';

import { AerialTracingPanel } from './aerial-tracing-panel';
import type { MapEditorActions } from './use-map-editor-actions';

const tracing: WireAerialTracingResult = {
  source: 'usgsNaip',
  disclaimer: 'Review every outline before adding it.',
  proposals: [
    {
      category: 'lot',
      label: 'Lot boundary',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [20, 0],
            [20, 30],
            [0, 30],
            [0, 0],
          ],
        ],
      },
      confidence: 0.8,
      evidence: 'inferred',
    },
    {
      category: 'structure',
      label: 'House',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [5, 8],
            [15, 8],
            [15, 18],
            [5, 18],
            [5, 8],
          ],
        ],
      },
      confidence: 0.94,
      evidence: 'visible',
    },
  ],
};

function renderPanel(acceptAerialProposals = vi.fn().mockResolvedValue(1)) {
  render(
    <LocalizationProvider locale="en">
      <AerialTracingPanel
        tracing={tracing}
        actions={{ acceptAerialProposals } as unknown as MapEditorActions}
        onDismiss={vi.fn()}
      />
    </LocalizationProvider>,
  );
  return acceptAerialProposals;
}

describe('AerialTracingPanel', () => {
  it('keeps the review open and updates its count when an object is unchecked', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('checkbox', { name: /House/ }));

    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /House/ }).checked).toBe(false);
    expect(screen.getByRole('button', { name: 'Add selected (1)' })).toBeDefined();
  });

  it('submits only the objects that remain selected', async () => {
    const acceptAerialProposals = renderPanel();

    fireEvent.click(screen.getByRole('checkbox', { name: /House/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected (1)' }));

    await vi.waitFor(() => {
      expect(acceptAerialProposals).toHaveBeenCalledWith(tracing, [0]);
    });
  });
});
