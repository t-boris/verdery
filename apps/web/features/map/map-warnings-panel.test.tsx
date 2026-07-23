import type { WireValidationIssue } from '@/core/api/public';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MapWarningsPanel } from './map-warnings-panel';
import type { MapObjectRecord } from './types';

/**
 * The real API always returns `validationSummary: []` today (see
 * `map-warnings-panel.tsx`'s doc comment) — this test constructs its own
 * `WireValidationIssue[]` fixtures, the same shape
 * `apps/ios/Tests/CoreNetworkingTests/MapGatewayTests.swift`'s fixture builds
 * one entry of, to verify the panel end to end against realistic data.
 */
const LOT: MapObjectRecord = {
  id: 'obj-lot',
  gardenId: 'garden-1',
  category: 'lot',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
  label: 'Backyard',
  lifecycleState: 'active',
  revision: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function findRecord(objectId: string): MapObjectRecord | null {
  return objectId === LOT.id ? LOT : null;
}

function renderPanel(warnings: readonly WireValidationIssue[], onSelectObject = vi.fn()) {
  render(
    <LocalizationProvider locale="en">
      <MapWarningsPanel
        warnings={warnings}
        findRecord={findRecord}
        onSelectObject={onSelectObject}
      />
    </LocalizationProvider>,
  );
}

describe('MapWarningsPanel', () => {
  it('shows the empty-state message when there are no warnings', () => {
    renderPanel([]);

    expect(screen.getByText('No validation warnings for this garden yet.')).toBeDefined();
  });

  it('renders a known code with its localized message, a non-color severity indicator, and a selectable affected object', () => {
    const onSelectObject = vi.fn();
    renderPanel(
      [
        {
          code: 'geometry.polygon.below_minimum_area',
          severity: 'warning',
          affectedObjectIds: [LOT.id],
        },
      ],
      onSelectObject,
    );

    expect(screen.getByText('This shape is smaller than the minimum allowed area.')).toBeDefined();
    // Severity is a visible text label, not color alone.
    expect(screen.getByText('Warning')).toBeDefined();

    screen.getByRole('button', { name: 'Backyard' }).click();
    expect(onSelectObject).toHaveBeenCalledWith(LOT.id);
  });

  it('falls back to a generic message for an unrecognized code instead of failing', () => {
    renderPanel([{ code: 'geometry.objects.some_future_rule', severity: 'error' }]);

    expect(screen.getByText('Validation note: geometry.objects.some_future_rule')).toBeDefined();
    expect(screen.getByText('Error')).toBeDefined();
  });

  it('renders no affected-object buttons when a warning names none', () => {
    renderPanel([{ code: 'geometry.objects.some_future_rule', severity: 'error' }]);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
