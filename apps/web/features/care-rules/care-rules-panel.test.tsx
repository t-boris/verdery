import type { CareRule, GardenCareRulesResult } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { CareRulesPanel } from './care-rules-panel';
import { useGardenCareRules } from './queries';

vi.mock('./queries', () => ({ useGardenCareRules: vi.fn() }));

const mockedUseCareRules = vi.mocked(useGardenCareRules);

function mockCareRules(fields: Record<string, unknown>): void {
  mockedUseCareRules.mockReturnValue(fields as unknown as ReturnType<typeof useGardenCareRules>);
}

function rule(overrides: Partial<CareRule> = {}): CareRule {
  return {
    ruleKey: 'watering.dry-spell-check',
    version: 2,
    careCategory: 'watering',
    safetyTier: 'ordinary_care',
    urgency: 'normal',
    actionTitle: 'Check whether this plant needs watering',
    description: 'Suggests a watering check when accumulated rainfall falls short.',
    reviewStatus: 'awaiting_horticultural_review',
    usesWeather: true,
    blockers: [],
    ...overrides,
  };
}

function result(rules: CareRule[]): GardenCareRulesResult {
  return { gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01', rules };
}

function renderPanel() {
  return render(
    <LocalizationProvider locale="en">
      <CareRulesPanel gardenId="019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01" />
    </LocalizationProvider>,
  );
}

describe('CareRulesPanel', () => {
  it('names every blocked check with the reason, not a generic failure', () => {
    mockCareRules({
      data: result([rule({ blockers: ['gardenNotGeoreferenced', 'awaitingHorticulturalReview'] })]),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.getByText(/This garden has no location/u)).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('offers a way to fix the one blocker a reader can fix', () => {
    mockCareRules({
      data: result([rule({ blockers: ['gardenNotGeoreferenced'] })]),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.getByRole('link', { name: 'Set the location' })).toBeTruthy();
  });

  it('offers no action for a blocker nobody using the app can clear', () => {
    mockCareRules({
      data: result([rule({ blockers: ['noWeatherProvider'] })]),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.queryByRole('link', { name: 'Set the location' })).toBeNull();
    expect(screen.getByText(/No weather provider is switched on/u)).toBeTruthy();
  });

  it('does not call a rule blocked merely because its review is outstanding — it still runs', () => {
    mockCareRules({
      data: result([rule({ blockers: ['awaitingHorticulturalReview'] })]),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.getByText('Running')).toBeTruthy();
    // ...but the disclosure is still shown, never quietly omitted.
    expect(screen.getByText(/thresholds are placeholders/u)).toBeTruthy();
  });

  it('marks an elevated-risk rule as such', () => {
    mockCareRules({
      data: result([rule({ safetyTier: 'elevated_risk', blockers: [] })]),
      isPending: false,
      isLoadingError: false,
    });

    renderPanel();

    expect(screen.getByText('Elevated risk')).toBeTruthy();
  });
});
