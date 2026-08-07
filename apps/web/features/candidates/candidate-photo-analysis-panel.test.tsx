import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { CandidatePhotoAnalysisPanel } from './candidate-photo-analysis-panel';

describe('CandidatePhotoAnalysisPanel', () => {
  it('renders the complete identification and condition result as unconfirmed analysis', () => {
    render(
      <LocalizationProvider locale="en">
        <CandidatePhotoAnalysisPanel
          analysis={{
            commonName: 'Tomato',
            scientificName: 'Solanum lycopersicum',
            familyName: 'Solanaceae',
            genusName: 'Solanum',
            varietyLabel: 'Roma',
            identificationConfidenceScore: 0.93,
            estimatedAgeMonthsMin: 2,
            estimatedAgeMonthsMax: 4,
            lifecycleStage: 'flowering',
            estimatedAcquisitionDate: '2026-05-01',
            analyzedAt: '2026-08-06T12:00:00Z',
            condition: {
              kind: 'stress',
              label: 'Mild water stress',
              confidenceScore: 0.74,
              evidenceSummary: 'Slight leaf curl is visible.',
              alternativeExplanations: ['Recent heat exposure'],
              safetyClass: 'monitor',
              requestedAdditionalEvidence: true,
              requestedViewPurposes: ['leaf_back'],
              careGuidance: 'Check soil moisture and drainage.',
            },
          }}
        />
      </LocalizationProvider>,
    );

    expect(screen.getByText('Solanum lycopersicum')).toBeTruthy();
    expect(screen.getByText('Solanaceae')).toBeTruthy();
    expect(screen.getByText('Roma')).toBeTruthy();
    expect(screen.getByText('93%')).toBeTruthy();
    expect(screen.getByText('2–4 months')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mild water stress' })).toBeTruthy();
    expect(screen.getByText('Other possible explanations')).toBeTruthy();
    expect(screen.getByText('Recent heat exposure')).toBeTruthy();
    expect(screen.getByText(/AI-generated visual estimates/)).toBeTruthy();
  });
});
