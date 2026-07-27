import type { PlantListResult, SeasonalPlanResult } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { useActivePlantNamesLookup, useSeasonalPlan } from './queries';
import { SeasonalPlanView } from './seasonal-plan-view';

vi.mock('./queries', () => ({
  useSeasonalPlan: vi.fn(),
  useActivePlantNamesLookup: vi.fn(),
}));

const mockedUseSeasonalPlan = vi.mocked(useSeasonalPlan);
const mockedUsePlantNames = vi.mocked(useActivePlantNamesLookup);

const TRANSPORT_FAILURE = {
  ok: false as const,
  kind: 'transport' as const,
  code: 'client.transport_failure',
  fallbackMessage: 'The API could not be reached.',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: true,
  details: [],
  status: null,
};

function mockPlan(fields: Record<string, unknown>): void {
  mockedUseSeasonalPlan.mockReturnValue(fields as unknown as ReturnType<typeof useSeasonalPlan>);
}

function mockPlantNames(data: PlantListResult | undefined = { items: [] }): void {
  mockedUsePlantNames.mockReturnValue({
    isPending: false,
    isLoadingError: false,
    isError: false,
    data,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useActivePlantNamesLookup>);
}

function queryResult(
  data: SeasonalPlanResult | undefined,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    isPending: false,
    isLoadingError: false,
    isRefetchError: false,
    isError: false,
    data,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderView() {
  return render(
    <LocalizationProvider locale="en">
      <SeasonalPlanView gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

const PLANT_1 = {
  id: 'plant-1',
  gardenId: 'garden-1',
  gardenAreaMapObjectId: null,
  placementMapObjectId: null,
  displayName: 'Roma Tomato',
  taxonomyReferenceId: 'taxon-1',
  varietyLabel: null,
  acceptedIdentificationId: null,
  acquisitionDate: null,
  acquisitionDateType: null,
  groupingKind: 'individual' as const,
  quantity: null,
  lifecycleStage: 'growing' as const,
  status: 'active' as const,
  conditionNote: null,
  careGuidanceNote: null,
  revision: 1,
  createdByProfileId: 'profile-1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('SeasonalPlanView', () => {
  it('announces loading before the first result arrives', () => {
    mockPlan(queryResult(undefined, { isPending: true }));
    mockPlantNames();
    renderView();

    expect(screen.getByRole('status').textContent).toBe('Loading the seasonal plan.');
  });

  it('shows the failure and a retry action when the first load fails', () => {
    const refetch = vi.fn();
    mockPlan(
      queryResult(undefined, {
        isLoadingError: true,
        isError: true,
        error: { failure: TRANSPORT_FAILURE },
        refetch,
      }),
    );
    mockPlantNames();
    renderView();

    expect(screen.getByRole('alert')).toBeTruthy();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps the last data visible with a stale indicator when a refetch fails offline', () => {
    mockPlan(
      queryResult(
        { gardenId: 'garden-1', hemisphere: 'northern', plants: [], rotationStatus: [] },
        { isRefetchError: true, isError: true, error: { failure: TRANSPORT_FAILURE } },
      ),
    );
    mockPlantNames();
    renderView();

    expect(screen.getByText('You are offline')).toBeTruthy();
  });

  it('shows the hemisphere-unknown empty state with a link into map calibration', () => {
    mockPlan(
      queryResult({ gardenId: 'garden-1', hemisphere: null, plants: [], rotationStatus: [] }),
    );
    mockPlantNames();
    renderView();

    expect(screen.getByText("We don't know your season yet")).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Set the garden location on the map' });
    expect(link.getAttribute('href')).toBe('/application/gardens/garden-1/map');
  });

  it('de-emphasizes a plant with no seasonal data without hiding it', () => {
    mockPlan(
      queryResult({
        gardenId: 'garden-1',
        hemisphere: 'northern',
        plants: [
          {
            plantId: 'plant-1',
            taxonomyReferenceId: 'taxon-1',
            seasonalFact: { status: 'noSeasonalData' },
          },
        ],
        rotationStatus: [],
      }),
    );
    mockPlantNames({ items: [PLANT_1] });
    renderView();

    expect(screen.getByText('Roma Tomato')).toBeTruthy();
    expect(screen.getByText('No reviewed seasonal data for this plant yet.')).toBeTruthy();
  });

  it('renders a reviewed plant’s configured windows as month names', () => {
    mockPlan(
      queryResult({
        gardenId: 'garden-1',
        hemisphere: 'northern',
        plants: [
          {
            plantId: 'plant-1',
            taxonomyReferenceId: 'taxon-1',
            seasonalFact: {
              status: 'reviewed',
              timing: {
                sowIndoorsStartMonth: 2,
                sowIndoorsEndMonth: 4,
                sowOutdoorsStartMonth: null,
                sowOutdoorsEndMonth: null,
                transplantStartMonth: null,
                transplantEndMonth: null,
                harvestStartMonth: 7,
                harvestEndMonth: 9,
                daysToMaturityMin: null,
                daysToMaturityMax: null,
                successionIntervalDays: null,
                rotationRestSeasons: 2,
              },
            },
          },
        ],
        rotationStatus: [],
      }),
    );
    mockPlantNames({ items: [PLANT_1] });
    renderView();

    expect(screen.getByText('February – April')).toBeTruthy();
    expect(screen.getByText('July – September')).toBeTruthy();
  });

  it('falls back to the raw plant id when the name lookup has no entry', () => {
    mockPlan(
      queryResult({
        gardenId: 'garden-1',
        hemisphere: 'northern',
        plants: [
          {
            plantId: 'plant-missing',
            taxonomyReferenceId: null,
            seasonalFact: { status: 'noSeasonalData' },
          },
        ],
        rotationStatus: [],
      }),
    );
    mockPlantNames({ items: [] });
    renderView();

    expect(screen.getByText('Plant plant-missing')).toBeTruthy();
  });

  it('surfaces a rest-period conflict prominently, in plain language', () => {
    mockPlan(
      queryResult({
        gardenId: 'garden-1',
        hemisphere: 'northern',
        plants: [],
        rotationStatus: [
          {
            plantId: 'plant-1',
            gardenAreaMapObjectId: 'area-1',
            family: 'Solanaceae',
            priorFamily: 'Solanaceae',
            priorOccupancyEndedAt: '2026-06-01T00:00:00Z',
            elapsedDays: 40,
            rotationRestSeasons: 2,
            restPeriodThresholdDays: 730,
            withinRestPeriod: true,
          },
        ],
      }),
    );
    mockPlantNames({ items: [PLANT_1] });
    renderView();

    expect(
      screen.getByText(
        'This bed grew Solanaceae 40 days ago; the recommended rest for Solanaceae is 730 days.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Rest-period conflict')).toBeTruthy();
  });

  it('keeps a non-conflicting rotation entry out of sight until the disclosure opens, with no warning styling', () => {
    mockPlan(
      queryResult({
        gardenId: 'garden-1',
        hemisphere: 'northern',
        plants: [],
        rotationStatus: [
          {
            plantId: 'plant-2',
            gardenAreaMapObjectId: 'area-2',
            family: 'Fabaceae',
            priorFamily: null,
            priorOccupancyEndedAt: null,
            elapsedDays: null,
            rotationRestSeasons: null,
            restPeriodThresholdDays: null,
            withinRestPeriod: false,
          },
        ],
      }),
    );
    mockPlantNames({ items: [] });
    renderView();

    expect(screen.queryByText('Fabaceae: no known prior occupant for this bed.')).toBeNull();
    expect(screen.queryByText('Rest-period conflict')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show every tracked bed' }));

    expect(screen.getByText('Fabaceae: no known prior occupant for this bed.')).toBeTruthy();
  });
});
