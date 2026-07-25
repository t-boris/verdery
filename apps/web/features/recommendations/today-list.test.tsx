import type { TodayRecommendation, TodayResult } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { useTodayRecommendations } from './queries';
import { TodayList } from './today-list';

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false, isSuccess: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./queries', () => ({
  useTodayRecommendations: vi.fn(),
  useCompleteRecommendation: () => idleMutation,
  usePostponeRecommendation: () => idleMutation,
  useDismissRecommendation: () => idleMutation,
  useMarkRecommendationIrrelevant: () => idleMutation,
  useConvertRecommendationToTask: () => idleMutation,
}));

const mockedUseToday = vi.mocked(useTodayRecommendations);

/**
 * Only the fields `today-list.tsx` actually reads are supplied — this is not
 * a real `UseQueryResult`, so the loosely-typed literal is cast through
 * `unknown` once, in this one helper. Mirrors `plant-list.test.tsx`'s own
 * `mockSearchResult`.
 */
function mockTodayResult(fields: Record<string, unknown>): void {
  mockedUseToday.mockReturnValue(fields as unknown as ReturnType<typeof useTodayRecommendations>);
}

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

function item(id: string, actionTitle: string): TodayRecommendation {
  return {
    id,
    gardenId: 'garden-1',
    ruleKey: 'observation.routine-check-reminder',
    ruleVersion: 1,
    careCategory: 'observation',
    safetyTier: 'ordinary_care',
    state: 'presented',
    urgency: 'low',
    targetKind: 'garden',
    targetGardenAreaMapObjectId: null,
    targetPlantId: null,
    windowStart: null,
    windowEnd: null,
    explanation: 'A seeded reason.',
    supersedesCandidateId: null,
    presentedAt: '2026-07-21T09:00:00Z',
    revision: 2,
    createdAt: '2026-07-21T09:00:00Z',
    updatedAt: '2026-07-21T09:00:00Z',
    actionTitle,
    priorityScore: 40,
    priorityFactors: [],
    evidence: [
      {
        id: `${id}-evidence`,
        kind: 'garden_context',
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: null,
        sourceWeatherRecordId: null,
        factKey: 'garden.context',
        factValue: null,
      },
    ],
    targetDisplayName: null,
  };
}

function todayResult(items: readonly TodayRecommendation[]): TodayResult {
  return { gardenId: 'garden-1', generatedAt: '2026-07-21T09:00:00Z', items: [...items] };
}

function queryResult(
  data: TodayResult | undefined,
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

function renderList() {
  return render(
    <LocalizationProvider locale="en">
      <TodayList gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

describe('TodayList', () => {
  it('announces loading before the first result arrives', () => {
    mockTodayResult(queryResult(undefined, { isPending: true }));
    renderList();

    expect(screen.getByRole('status').textContent).toBe('Loading recommendations.');
  });

  it('shows the failure and a retry action when the first load fails', () => {
    const refetch = vi.fn();
    mockTodayResult(
      queryResult(undefined, {
        isLoadingError: true,
        isError: true,
        error: { failure: TRANSPORT_FAILURE },
        refetch,
      }),
    );
    renderList();

    expect(screen.getByRole('alert')).toBeTruthy();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps the last data visible with a stale indicator when a refetch fails offline', () => {
    mockTodayResult(
      queryResult(todayResult([item('rec-1', 'Check whether this plant needs watering')]), {
        isRefetchError: true,
        isError: true,
        error: { failure: TRANSPORT_FAILURE },
      }),
    );
    renderList();

    expect(screen.getByText('Check whether this plant needs watering')).toBeTruthy();
    expect(screen.getByText('You are offline')).toBeTruthy();
  });

  it('says so when nothing needs attention', () => {
    mockTodayResult(queryResult(todayResult([])));
    renderList();

    expect(screen.getByText('Nothing needs attention right now.')).toBeTruthy();
  });

  it('renders the items in the order the server ranked them', () => {
    mockTodayResult(
      queryResult(
        todayResult([
          item('rec-1', 'Consider protective cover against forecast frost'),
          item('rec-2', 'Record a quick condition check for this plant'),
        ]),
      ),
    );
    renderList();

    const titles = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(titles[0]).toContain('Consider protective cover against forecast frost');
    expect(titles[1]).toContain('Record a quick condition check for this plant');
  });
});
