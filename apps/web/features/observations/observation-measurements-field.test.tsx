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

  it('adds the next free kind rather than a second row of one already taken', () => {
    // `observation_measurement_unique_kind` permits one row per kind; a second
    // height would be refused by the server for a rule the reader never saw.
    const onChange = renderField([{ kind: 'height', value: 10, unit: 'cm' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Add a measurement' }));

    expect(onChange).toHaveBeenCalledWith([
      { kind: 'height', value: 10, unit: 'cm' },
      { kind: 'width', value: 0, unit: 'cm' },
    ]);
  });

  it('stops offering to add once every kind is in use', () => {
    renderField([
      { kind: 'height', value: 10, unit: 'cm' },
      { kind: 'width', value: 20, unit: 'cm' },
      { kind: 'count', value: 3, unit: 'pcs' },
    ]);

    expect(screen.queryByRole('button', { name: 'Add a measurement' })).toBeNull();
  });

  it('offers a row only the kinds no other row has taken', () => {
    renderField([
      { kind: 'height', value: 10, unit: 'cm' },
      { kind: 'count', value: 3, unit: 'pcs' },
    ]);

    const [heightRow] = screen.getAllByLabelText('Measurement');
    const offered = [...(heightRow as HTMLSelectElement).options].map((option) => option.value);
    // Its own kind stays selectable — otherwise the control would show a value
    // that is not among its options.
    expect(offered).toEqual(['height', 'width']);
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
