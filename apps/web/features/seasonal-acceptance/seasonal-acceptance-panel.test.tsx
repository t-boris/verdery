import type {
  GardenSeasonalAcceptanceQueue,
  GardenSeasonalFactAwaitingAcceptance,
  SeasonalPlanTaxonomyTiming,
} from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ApiFailure } from '@/core/api/public';
import { LocalizationProvider } from '@/shared/localization/public';

import { SeasonalAcceptancePanel } from './seasonal-acceptance-panel';
import { useAcceptSeasonalFact, useSeasonalAcceptanceQueue } from './queries';

vi.mock('./queries', () => ({
  useSeasonalAcceptanceQueue: vi.fn(),
  useAcceptSeasonalFact: vi.fn(),
}));

const mockedUseQueue = vi.mocked(useSeasonalAcceptanceQueue);
const mockedUseAccept = vi.mocked(useAcceptSeasonalFact);

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01';
const FACT_ID = '4f3a1c2e-9b7d-4e51-8a06-2d5c9f1b3e7a';

function mockQueue(fields: Record<string, unknown>): void {
  mockedUseQueue.mockReturnValue(
    fields as unknown as ReturnType<typeof useSeasonalAcceptanceQueue>,
  );
}

function mockAccept(fields: Record<string, unknown> = {}): { mutate: ReturnType<typeof vi.fn> } {
  const mutate = vi.fn();
  mockedUseAccept.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    ...fields,
  } as unknown as ReturnType<typeof useAcceptSeasonalFact>);
  return { mutate };
}

function timing(overrides: Partial<SeasonalPlanTaxonomyTiming> = {}): SeasonalPlanTaxonomyTiming {
  return {
    sowIndoorsStartMonth: 3,
    sowIndoorsEndMonth: 4,
    sowOutdoorsStartMonth: null,
    sowOutdoorsEndMonth: null,
    transplantStartMonth: null,
    transplantEndMonth: null,
    harvestStartMonth: 7,
    harvestEndMonth: null,
    daysToMaturityMin: null,
    daysToMaturityMax: null,
    successionIntervalDays: null,
    rotationRestSeasons: null,
    ...overrides,
  };
}

function item(
  overrides: Partial<GardenSeasonalFactAwaitingAcceptance> = {},
): GardenSeasonalFactAwaitingAcceptance {
  return {
    id: FACT_ID,
    taxonomyReferenceId: '2a7c5d9e-1b3f-4a62-9d80-6e4f2c8a1b05',
    scientificName: 'Solanum lycopersicum',
    commonName: 'Tomato',
    hemisphere: 'northern',
    timing: timing(),
    authoringMethod: 'human_authored',
    reviewStatus: 'awaiting_horticultural_review',
    createdAt: '2026-08-01T09:00:00Z',
    ...overrides,
  };
}

function queue(
  overrides: Partial<GardenSeasonalAcceptanceQueue> = {},
): GardenSeasonalAcceptanceQueue {
  return { hemisphereKnown: true, items: [item()], ...overrides };
}

function failure(status: number | null): ApiFailure {
  return {
    ok: false,
    kind: 'contract',
    code: 'auth.forbidden',
    fallbackMessage: 'Forbidden.',
    correlationId: 'test-correlation',
    retryable: false,
    details: [],
    status,
  };
}

function renderPanel() {
  return render(
    <LocalizationProvider locale="en">
      <SeasonalAcceptancePanel gardenId={GARDEN_ID} />
    </LocalizationProvider>,
  );
}

describe('SeasonalAcceptancePanel', () => {
  it('shows the taxon by name with its actual months — never bare identifiers', () => {
    mockQueue({ data: queue(), isPending: false, isLoadingError: false });
    mockAccept();

    renderPanel();

    expect(screen.getByText('Tomato')).toBeTruthy();
    expect(screen.getByText('Solanum lycopersicum')).toBeTruthy();
    expect(screen.getByText('Sow indoors')).toBeTruthy();
    expect(screen.getByText('March – April')).toBeTruthy();
    // A single configured bound renders as that one month, not an invented
    // range.
    expect(screen.getByText('July')).toBeTruthy();
    // No window means no row, rather than a fabricated one.
    expect(screen.queryByText('Transplant')).toBeNull();
  });

  it('accepts one taxon at a time, by that fact id', () => {
    mockQueue({ data: queue(), isPending: false, isLoadingError: false });
    const { mutate } = mockAccept();

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Use in this garden' }));

    expect(mutate).toHaveBeenCalledWith(FACT_ID);
  });

  it('offers no way to accept everything at once — the gate is that a person saw what they signed', () => {
    mockQueue({
      data: queue({ items: [item(), item({ id: '7c1e4b28-3f5a-4d09-b6e2-0a8d3f1c5e94' })] }),
      isPending: false,
      isLoadingError: false,
    });
    mockAccept();

    renderPanel();

    expect(screen.getAllByRole('button', { name: 'Use in this garden' })).toHaveLength(2);
  });

  it('discloses that timing carries no horticultural review, rather than hiding it', () => {
    mockQueue({ data: queue(), isPending: false, isLoadingError: false });
    mockAccept();

    renderPanel();

    expect(screen.getByText('Not reviewed by a horticulturist')).toBeTruthy();
  });

  it('quotes the licensed source when the timing was extracted from one', () => {
    mockQueue({
      data: queue({
        items: [
          item({
            authoringMethod: 'ai_extracted_from_source',
            sourceCitation: 'USDA National Agricultural Library',
          }),
        ],
      }),
      isPending: false,
      isLoadingError: false,
    });
    mockAccept();

    renderPanel();

    expect(screen.getByText(/USDA National Agricultural Library/u)).toBeTruthy();
  });

  it('separates "nothing to decide" from "cannot decide anything yet"', () => {
    mockQueue({
      data: queue({ hemisphereKnown: false, items: [] }),
      isPending: false,
      isLoadingError: false,
    });
    mockAccept();

    const { unmount } = renderPanel();

    expect(screen.getByText(/no location yet/u)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set the location' })).toBeTruthy();
    unmount();

    mockQueue({
      data: queue({ hemisphereKnown: true, items: [] }),
      isPending: false,
      isLoadingError: false,
    });
    renderPanel();

    expect(screen.getByText(/Nothing left to decide/u)).toBeTruthy();
  });

  it('renders nothing for a viewer, who is refused this queue and can never act on it', () => {
    mockQueue({
      data: undefined,
      isPending: false,
      isLoadingError: true,
      error: { failure: failure(403) },
    });
    mockAccept();

    const { container } = renderPanel();

    expect(container.textContent).toBe('');
  });

  it('surfaces a real read failure with a way to retry', () => {
    const refetch = vi.fn();
    mockQueue({
      data: undefined,
      isPending: false,
      isLoadingError: true,
      error: { failure: failure(503) },
      refetch,
    });
    mockAccept();

    renderPanel();

    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('reports an unlocatable garden in place, not as a failure, when an accept lands on one', () => {
    mockQueue({ data: queue(), isPending: false, isLoadingError: false });
    mockAccept({ data: { outcome: 'hemisphereUnknown' } });

    renderPanel();

    expect(screen.getByText(/no location yet/u)).toBeTruthy();
  });
});
