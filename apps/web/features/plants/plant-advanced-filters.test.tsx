import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import {
  countActiveFilters,
  EMPTY_PLANT_ADVANCED_FILTERS,
  PlantAdvancedFilters,
  toRecencyParams,
} from './plant-advanced-filters';

function renderPanel(onChange = vi.fn()) {
  render(
    <LocalizationProvider locale="en">
      <PlantAdvancedFilters value={EMPTY_PLANT_ADVANCED_FILTERS} onChange={onChange} />
    </LocalizationProvider>,
  );
  return onChange;
}

describe('toRecencyParams', () => {
  // The two API bounds are independent; this control must never set both,
  // because a plant cannot be seen within 7 days AND unseen for 30.
  it.each(['any', 'seen_7', 'seen_30', 'not_seen_30', 'not_seen_90', 'never_seen'] as const)(
    'sets at most one bound for %s',
    (filter) => {
      const { observedWithinDays, notObservedForDays } = toRecencyParams(filter);
      expect(observedWithinDays === null || notObservedForDays === null).toBe(true);
    },
  );

  // "Never recorded" has no observation at all, so it matches every neglect
  // bound; the widest one is the only value that cannot exclude it.
  it('expresses "never recorded" as the widest neglect bound', () => {
    expect(toRecencyParams('never_seen')).toEqual({
      observedWithinDays: null,
      notObservedForDays: 3650,
    });
  });
});

describe('countActiveFilters', () => {
  it('counts nothing when every filter is at its default', () => {
    expect(countActiveFilters(EMPTY_PLANT_ADVANCED_FILTERS)).toBe(0);
  });

  // A region alone narrows nothing without a status, but it is still a value
  // the reader typed and must be visible in the count.
  it('counts a typed region', () => {
    expect(
      countActiveFilters({ ...EMPTY_PLANT_ADVANCED_FILTERS, distributionRegion: 'US-CA' }),
    ).toBe(1);
  });

  it('ignores a region of only spaces', () => {
    expect(countActiveFilters({ ...EMPTY_PLANT_ADVANCED_FILTERS, distributionRegion: '   ' })).toBe(
      0,
    );
  });
});

describe('PlantAdvancedFilters', () => {
  it('keeps the fields collapsed until asked', () => {
    renderPanel();

    expect(screen.queryByLabelText('Journal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
    expect(screen.getByLabelText('Journal')).toBeTruthy();
  });

  it('reports a selection back to the caller', () => {
    const onChange = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
    fireEvent.change(screen.getByLabelText('Flagged concern'), { target: { value: 'pest' } });

    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_PLANT_ADVANCED_FILTERS,
      healthConcern: 'pest',
    });
  });

  // The month means nothing without an activity, and an enabled control that
  // does nothing is a worse answer than a disabled one.
  it('disables the month until an activity is chosen', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
    expect(screen.getByLabelText<HTMLSelectElement>('In month').disabled).toBe(true);
  });
});
