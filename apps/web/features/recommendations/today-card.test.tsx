import type { TodayRecommendation } from '@verdery/api-contracts';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { TodayCard } from './today-card';

const completeMutate = vi.fn();
const postponeMutate = vi.fn();
const dismissMutate = vi.fn();
const irrelevantMutate = vi.fn();
const convertMutate = vi.fn();
const routerPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock('./queries', () => ({
  useCompleteRecommendation: () => ({ mutate: completeMutate, isPending: false, isError: false }),
  usePostponeRecommendation: () => ({ mutate: postponeMutate, isPending: false, isError: false }),
  useDismissRecommendation: () => ({ mutate: dismissMutate, isPending: false, isError: false }),
  useMarkRecommendationIrrelevant: () => ({
    mutate: irrelevantMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
  useConvertRecommendationToTask: () => ({
    mutate: convertMutate,
    isPending: false,
    isError: false,
  }),
}));

const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01';

const ITEM: TodayRecommendation = {
  id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a05',
  gardenId: 'garden-1',
  ruleKey: 'watering.dry-spell-check',
  ruleVersion: 1,
  careCategory: 'watering',
  safetyTier: 'ordinary_care',
  state: 'presented',
  urgency: 'normal',
  targetKind: 'plant',
  targetGardenAreaMapObjectId: null,
  targetPlantId: PLANT_ID,
  windowStart: null,
  windowEnd: null,
  explanation: 'No rain has been recorded for 9 days.',
  supersedesCandidateId: null,
  presentedAt: '2026-07-21T09:00:00Z',
  revision: 2,
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
  actionTitle: 'Check whether this plant needs watering',
  priorityScore: 45,
  priorityFactors: [
    { kind: 'urgency_window', contribution: 25, basis: { validityWindowDays: 3 } },
    { kind: 'confidence', contribution: 10, basis: { weatherFreshness: 'stale' } },
  ],
  evidence: [
    {
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a06',
      kind: 'plant_identity',
      sourceObservationId: null,
      sourceTaskId: null,
      sourcePlantId: PLANT_ID,
      sourceWeatherRecordId: null,
      factKey: 'plant.watering_recency',
      factValue: { daysSinceRain: 9 },
    },
  ],
  targetDisplayName: 'Tomato row',
};

function renderCard(item: TodayRecommendation = ITEM) {
  return render(
    <LocalizationProvider locale="en">
      <TodayCard gardenId="garden-1" item={item} />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  act(() => onlineManager.setOnline(true));
});

describe('TodayCard — FR-24 field list', () => {
  it('shows the action title, reason, urgency, target name, and priority score', () => {
    renderCard();

    expect(screen.getByText('Check whether this plant needs watering')).toBeTruthy();
    expect(screen.getByText('No rain has been recorded for 9 days.')).toBeTruthy();
    expect(screen.getByText('Normal')).toBeTruthy();
    expect(screen.getByText('Tomato row')).toBeTruthy();
    expect(screen.getByText('Priority 45 / 100')).toBeTruthy();
  });

  it('renders uncertainty as readable text, labeling stale weather explicitly', () => {
    renderCard();

    expect(
      screen.getByText(
        'Confidence: +10 points — using cached weather data that may be out of date',
      ),
    ).toBeTruthy();
  });

  it('states the absence of a confidence signal honestly', () => {
    renderCard({ ...ITEM, priorityFactors: [] });

    expect(
      screen.getByText('No confidence signal was recorded for this recommendation.'),
    ).toBeTruthy();
  });

  it('marks an elevated-risk item and explains the caution', () => {
    renderCard({ ...ITEM, safetyTier: 'elevated_risk' });

    expect(screen.getByText('Elevated risk')).toBeTruthy();
    expect(
      screen.getByText('This suggestion carries elevated risk. Review it carefully before acting.'),
    ).toBeTruthy();
  });

  it('expands evidence and factors on demand, resolving only the carried display name', () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Show evidence and factors' }));

    expect(screen.getByText('Rule watering.dry-spell-check v1')).toBeTruthy();
    expect(screen.getByText('Urgency window')).toBeTruthy();
    expect(screen.getByText('+25 points')).toBeTruthy();
    expect(screen.getByText('Plant identity')).toBeTruthy();
    expect(screen.getByText('plant.watering_recency')).toBeTruthy();
    expect(screen.getByText('Plant: Tomato row')).toBeTruthy();
    expect(screen.getByText('daysSinceRain: 9')).toBeTruthy();
  });
});

describe('TodayCard — controls', () => {
  it('completes with the current revision', () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));

    expect(completeMutate).toHaveBeenCalledWith(2);
  });

  it('dismisses and marks irrelevant with the current revision', () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not relevant' }));

    expect(dismissMutate).toHaveBeenCalledWith(2);
    expect(irrelevantMutate).toHaveBeenCalledWith(2);
  });

  it('postpones with the entered horizon as an ISO timestamp', () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Postpone' }));
    fireEvent.change(screen.getByLabelText('Show again after (optional)'), {
      target: { value: '2026-08-01T09:00' },
    });
    // Two buttons now share the name: the card's panel toggle and the
    // panel's own submit — the submit is the second in document order.
    fireEvent.click(screen.getAllByRole('button', { name: 'Postpone' })[1]!);

    expect(postponeMutate).toHaveBeenCalledWith(
      {
        input: { postponedUntil: new Date('2026-08-01T09:00').toISOString() },
        expectedRevision: 2,
      },
      expect.anything(),
    );
  });

  it('sends a null horizon when none is entered — the engine falls back to recurrence', () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Postpone' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Postpone' })[1]!);

    expect(postponeMutate).toHaveBeenCalledWith(
      { input: { postponedUntil: null }, expectedRevision: 2 },
      expect.anything(),
    );
  });

  it('navigates to the tasks page after a successful conversion', () => {
    convertMutate.mockImplementation((_revision: number, options: { onSuccess: () => void }) =>
      options.onSuccess(),
    );
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Add to tasks' }));

    expect(convertMutate).toHaveBeenCalledWith(2, expect.anything());
    expect(routerPush).toHaveBeenCalledWith('/application/gardens/garden-1/tasks');
  });
});

describe('TodayCard — offline gate', () => {
  it('disables the command buttons while offline and re-enables them on reconnect', () => {
    renderCard();

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Complete' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add to tasks' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Dismiss' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Not relevant' }).disabled).toBe(
      true,
    );

    act(() => onlineManager.setOnline(true));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Complete' }).disabled).toBe(
      false,
    );
  });

  it('leaves the postpone and details toggles (local panels, not commands) enabled offline', () => {
    renderCard();

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Postpone' }).disabled).toBe(
      false,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Show evidence and factors' }).disabled,
    ).toBe(false);
  });
});
