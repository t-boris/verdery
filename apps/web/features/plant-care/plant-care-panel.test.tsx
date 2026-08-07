import type { PlantCareView, PlantWaterBalance } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantCarePanel } from './plant-care-panel';
import { usePlantCare } from './queries';

vi.mock('./queries', () => ({ usePlantCare: vi.fn() }));

const mockedUsePlantCare = vi.mocked(usePlantCare);

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e02';

function mockCare(fields: Record<string, unknown>): void {
  mockedUsePlantCare.mockReturnValue(fields as unknown as ReturnType<typeof usePlantCare>);
}

function water(overrides: Partial<PlantWaterBalance> = {}): PlantWaterBalance {
  return {
    known: true,
    windowDays: 7,
    daysCovered: 6,
    accumulatedMm: 30,
    referenceMm: 25,
    thresholdMm: 12.5,
    shortfallMm: 0,
    lastWetDayAt: '2026-08-05T19:00:00.000Z',
    ...overrides,
  };
}

function view(overrides: Partial<PlantCareView> = {}): PlantCareView {
  return {
    plantId: PLANT_ID,
    gardenId: GARDEN_ID,
    recommendations: [],
    tasks: [],
    water: water(),
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <LocalizationProvider locale="en">
      <PlantCarePanel gardenId={GARDEN_ID} plantId={PLANT_ID} />
    </LocalizationProvider>,
  );
}

describe('PlantCarePanel', () => {
  it('says the balance is UNKNOWN rather than showing zero when nothing is measured', () => {
    mockCare({
      isPending: false,
      isError: false,
      data: view({
        water: water({
          known: false,
          daysCovered: 0,
          accumulatedMm: null,
          shortfallMm: null,
          lastWetDayAt: null,
        }),
      }),
    });

    renderPanel();

    // The load-bearing assertion of this file. An unmeasured window rendered
    // as `0 mm` would state that no rain fell, which is a claim the engine
    // deliberately refuses to make — and it is the reading a gardener would
    // act on by watering.
    expect(screen.getByText(/Unknown is not the same as dry/)).toBeTruthy();
    expect(screen.queryByText('0 mm')).toBeNull();
  });

  it('reports a shortfall in millimetres and never a watering amount or schedule', () => {
    mockCare({
      isPending: false,
      isError: false,
      data: view({ water: water({ accumulatedMm: 4, shortfallMm: 8.5 }) }),
    });

    renderPanel();

    expect(screen.getByText('4 mm')).toBeTruthy();
    expect(screen.getByText(/8.5 mm short of what the window usually supplies/)).toBeTruthy();
    // No prescription anywhere: the rule that produced this number refuses to
    // give one, so the panel showing it must not invent one.
    expect(screen.queryByText(/litre|liter|minutes|water for/i)).toBeNull();
  });

  it('shows the plant is settled when the window is not short and nothing is open', () => {
    mockCare({ isPending: false, isError: false, data: view() });

    renderPanel();

    expect(screen.getByText(/At or above the 25 mm/)).toBeTruthy();
    expect(screen.getByText('Nothing is open for this plant right now.')).toBeTruthy();
  });

  it('lists the engine’s own explanation and rule identity for a recommendation', () => {
    mockCare({
      isPending: false,
      isError: false,
      data: view({
        recommendations: [
          {
            id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e03',
            ruleKey: 'watering.dry-spell-check',
            ruleVersion: 2,
            careCategory: 'watering',
            urgency: 'normal',
            safetyTier: 'ordinary_care',
            explanation: 'Only 4 mm of rain has fallen over 7 days.',
            state: 'presented',
            windowEnd: null,
            createdAt: '2026-08-07T10:00:00.000Z',
          },
        ],
      }),
    });

    renderPanel();

    expect(screen.getByText('Only 4 mm of rain has fallen over 7 days.')).toBeTruthy();
    expect(screen.getByText('Rule watering.dry-spell-check v2')).toBeTruthy();
  });
});
