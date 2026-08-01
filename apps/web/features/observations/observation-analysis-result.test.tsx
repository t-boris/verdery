import type { ImageAnalysisResult } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { AnalysisResultNotice } from './observation-analysis-result';

const mutateMock = vi.fn();

vi.mock('./queries', () => ({
  useSetHealthSuggestionDisposition: () => ({
    mutate: mutateMock,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
}));

function analysisResult(overrides: Partial<ImageAnalysisResult> = {}): ImageAnalysisResult {
  return {
    id: 'analysis-1',
    analysisKind: 'disease',
    suggestedLabel: 'Possible leaf spot',
    confidenceScore: 0.6,
    requiresConfirmation: true,
    requestedAdditionalEvidence: false,
    evidenceSummary: 'Brown spotting on lower leaves.',
    alternativeExplanations: ['Nutrient deficiency'],
    safetyClass: 'monitor',
    requestedViewPurposes: [],
    modelName: 'gemini-test',
    promptVersion: 3,
    disposition: 'unresolved',
    dispositionSetAt: null,
    dispositionSetByProfileId: null,
    createdAt: '2026-07-21T09:00:00Z',
    ...overrides,
  };
}

function renderNotice(result: ImageAnalysisResult) {
  return render(
    <LocalizationProvider locale="en">
      <AnalysisResultNotice gardenId="garden-1" plantId="plant-1" result={result} />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  mutateMock.mockClear();
});

describe('AnalysisResultNotice', () => {
  it('renders the evidence summary and alternative explanations', () => {
    renderNotice(analysisResult());

    expect(screen.getByText('What supports this: Brown spotting on lower leaves.')).toBeTruthy();
    expect(screen.getByText('Nutrient deficiency')).toBeTruthy();
  });

  it('shows an honest "no model reached" notice instead of a suggestion when modelName is null', () => {
    renderNotice(
      analysisResult({ modelName: null, suggestedLabel: 'No automated analysis available yet.' }),
    );

    expect(
      screen.getByText(
        'No AI model could be reached for this photo — this is a placeholder, not a suggestion to act on.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Possible/)).toBeNull();
  });

  it('saves the newly selected disposition', () => {
    renderNotice(analysisResult());

    fireEvent.change(screen.getByLabelText('Your review'), {
      target: { value: 'accepted_as_observation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));

    expect(mutateMock).toHaveBeenCalledWith({
      analysisResultId: 'analysis-1',
      disposition: 'accepted_as_observation',
    });
  });

  it('does not submit when the disposition selection did not change', () => {
    renderNotice(analysisResult());

    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));

    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('shows who/when it was reviewed once a disposition has been set', () => {
    renderNotice(
      analysisResult({ disposition: 'rejected', dispositionSetAt: '2026-07-22T09:00:00Z' }),
    );

    expect(screen.getByText(/Reviewed/)).toBeTruthy();
  });
});
