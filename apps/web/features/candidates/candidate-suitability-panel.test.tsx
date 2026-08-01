import type { SuitabilityAssessment } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { CandidateSuitabilityPanel } from './candidate-suitability-panel';
import { useCandidateSuitability, useRecalculateCandidateSuitability } from './queries';

vi.mock('./queries', () => ({
  useCandidateSuitability: vi.fn(),
  useRecalculateCandidateSuitability: vi.fn(),
}));

const mockedUseCandidateSuitability = vi.mocked(useCandidateSuitability);
const mockedUseRecalculate = vi.mocked(useRecalculateCandidateSuitability);

function mockSuitability(
  data: SuitabilityAssessment | null,
  overrides: Record<string, unknown> = {},
) {
  mockedUseCandidateSuitability.mockReturnValue({
    isPending: false,
    isError: false,
    data,
    error: null,
    ...overrides,
  } as unknown as ReturnType<typeof useCandidateSuitability>);
}

function renderPanel() {
  return render(
    <LocalizationProvider locale="en">
      <CandidateSuitabilityPanel gardenId="garden-1" candidateId="candidate-1" />
    </LocalizationProvider>,
  );
}

describe('CandidateSuitabilityPanel', () => {
  beforeEach(() => {
    mockedUseRecalculate.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useRecalculateCandidateSuitability>);
  });

  it('shows the "no assessment yet" message when none has ever been computed', () => {
    mockSuitability(null);

    renderPanel();

    expect(screen.getByText('No suitability assessment yet.')).toBeTruthy();
  });

  it('shows only the reason for an unknown finding, never a fabricated explanation', () => {
    mockSuitability({
      candidateId: 'candidate-1',
      findings: [{ category: 'unknown', axis: 'hardiness', reason: 'garden_context_missing' }],
    });

    renderPanel();

    expect(screen.getByText('Garden context not recorded yet.')).toBeTruthy();
  });

  it('shows the explanation and evidence for a match finding', () => {
    mockSuitability({
      candidateId: 'candidate-1',
      findings: [
        {
          category: 'match',
          axis: 'sun_exposure',
          explanation: 'This garden gets full sun.',
          evidence: [{ factKey: 'sun.hours', value: 8, sourceCitation: 'weather-service' }],
        },
      ],
    });

    renderPanel();

    expect(screen.getByText('This garden gets full sun.')).toBeTruthy();
    expect(screen.getByText(/sun\.hours/)).toBeTruthy();
  });

  it('shows the assumed value for an assumption finding', () => {
    mockSuitability({
      candidateId: 'candidate-1',
      findings: [
        {
          category: 'assumption',
          axis: 'soil_ph',
          explanation: 'Assuming neutral soil.',
          assumedValue: 'neutral',
        },
      ],
    });

    renderPanel();

    expect(screen.getByText('Assumed: neutral')).toBeTruthy();
  });
});
