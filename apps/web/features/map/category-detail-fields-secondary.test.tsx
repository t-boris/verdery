import type { AnnotationDetails } from '@verdery/geometry-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { AnnotationFields } from './category-detail-fields-secondary';

function renderFields(details: AnnotationDetails) {
  render(
    <LocalizationProvider locale="en">
      <AnnotationFields details={details} onChange={vi.fn()} />
    </LocalizationProvider>,
  );
}

describe('AnnotationFields', () => {
  it('shows no acquisition/uncertainty/original-entry fields when there is no measurement', () => {
    renderFields({});

    expect(screen.queryByLabelText('How measured')).toBeNull();
    expect(screen.queryByLabelText('Uncertainty')).toBeNull();
    expect(screen.queryByLabelText('Original entry')).toBeNull();
  });

  it('displays acquisition method read-only once a measurement exists, even without uncertainty or an original entry', () => {
    renderFields({ measurement: { value: 3, unit: 'metres', acquisitionMethod: 'userEntered' } });

    const acquisition = screen.getByLabelText<HTMLInputElement>('How measured');
    expect(acquisition.value).toBe('User-entered');
    expect(acquisition.readOnly).toBe(true);
    expect(screen.queryByLabelText('Uncertainty')).toBeNull();
    expect(screen.queryByLabelText('Original entry')).toBeNull();
  });

  it('displays uncertainty and original entry read-only when a measurement carries them, without the UI ever having written either', () => {
    renderFields({
      measurement: {
        value: 12.2,
        unit: 'metres',
        acquisitionMethod: 'arMeasurement',
        uncertainty: 0.1,
        originalEntry: '40 ft',
      },
    });

    expect(screen.getByLabelText<HTMLInputElement>('How measured').value).toBe('AR-measured');
    const uncertainty = screen.getByLabelText<HTMLInputElement>('Uncertainty');
    expect(uncertainty.value).toBe('± 0.1 Metres');
    expect(uncertainty.readOnly).toBe(true);
    const originalEntry = screen.getByLabelText<HTMLInputElement>('Original entry');
    expect(originalEntry.value).toBe('40 ft');
    expect(originalEntry.readOnly).toBe(true);
  });
});
