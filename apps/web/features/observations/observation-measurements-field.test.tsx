import type { ObservationMeasurementInput } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ObservationMeasurementsField } from './observation-measurements-field';

function renderField(
  value: readonly ObservationMeasurementInput[],
  onChange = vi.fn<(next: readonly ObservationMeasurementInput[]) => void>(),
) {
  render(
    <LocalizationProvider locale="en">
      <ObservationMeasurementsField value={value} onChange={onChange} />
    </LocalizationProvider>,
  );
  return onChange;
}

describe('ObservationMeasurementsField', () => {
  it('adds a row that is already a valid measurement', () => {
    const onChange = renderField([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add a measurement' }));

    // A row must be submittable as it stands: `unit` has a `minLength` of 1,
    // so a blank one would be rejected by the server rather than ignored.
    expect(onChange).toHaveBeenCalledWith([{ kind: 'height', value: 0, unit: 'cm' }]);
  });

  it('keeps the unit the reader typed rather than a vocabulary this client invented', () => {
    const onChange = renderField([{ kind: 'width', value: 40, unit: 'cm' }]);

    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'in' } });

    expect(onChange).toHaveBeenCalledWith([{ kind: 'width', value: 40, unit: 'in' }]);
  });

  it('reads an unparseable value as zero instead of NaN', () => {
    const onChange = renderField([{ kind: 'count', value: 3, unit: 'pcs' }]);

    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '' } });

    // NaN serialises to `null` and is refused by the server with nothing on
    // screen explaining why; zero is the schema's own minimum.
    expect(onChange).toHaveBeenCalledWith([{ kind: 'count', value: 0, unit: 'pcs' }]);
  });

  it('removes only the row whose control was used', () => {
    const rows: ObservationMeasurementInput[] = [
      { kind: 'height', value: 10, unit: 'cm' },
      { kind: 'width', value: 20, unit: 'cm' },
    ];
    const onChange = renderField(rows);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this measurement' })[1]!);

    expect(onChange).toHaveBeenCalledWith([{ kind: 'height', value: 10, unit: 'cm' }]);
  });
});
