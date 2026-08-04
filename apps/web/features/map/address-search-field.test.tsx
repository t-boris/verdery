import type { AddressCandidateListResult } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { AddressSearchField } from './address-search-field';
import { useAddressCandidates } from './queries';

const mutate = vi.fn();

vi.mock('./queries', () => ({ useAddressCandidates: vi.fn() }));

const mockedUseAddressCandidates = vi.mocked(useAddressCandidates);

function mockSearch(fields: Record<string, unknown>): void {
  mockedUseAddressCandidates.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    ...fields,
  } as unknown as ReturnType<typeof useAddressCandidates>);
}

function renderField(onPick = vi.fn()) {
  render(
    <LocalizationProvider locale="en">
      <AddressSearchField onPick={onPick} />
    </LocalizationProvider>,
  );
  return onPick;
}

const ONE_MATCH: AddressCandidateListResult = {
  items: [
    {
      formattedAddress: '100 GRAND AVE, DES MOINES, IA, 50309',
      position: [-93.63, 41.59],
      precision: 'streetAddress',
    },
  ],
  providerAvailable: true,
};

describe('AddressSearchField', () => {
  beforeEach(() => {
    mutate.mockReset();
    mockSearch({});
  });

  it('does not search a query too short to mean anything', () => {
    renderField();

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('searches the trimmed query', () => {
    renderField();

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '  100 Grand Ave  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    expect(mutate).toHaveBeenCalledWith('100 Grand Ave');
  });

  it('searches on Enter, since the panel around it is not a form', () => {
    renderField();

    const field = screen.getByLabelText('Address');
    fireEvent.change(field, { target: { value: '100 Grand Ave' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(mutate).toHaveBeenCalledWith('100 Grand Ave');
  });

  it('hands back longitude and latitude in the order the map expects', () => {
    mockSearch({ data: ONE_MATCH });
    const onPick = renderField();

    fireEvent.click(screen.getByRole('button', { name: /100 GRAND AVE/u }));

    expect(onPick).toHaveBeenCalledWith([-93.63, 41.59], '100 GRAND AVE, DES MOINES, IA, 50309');
  });

  it('says what kind of match a candidate is, so a street-only pin is not mistaken for a roof', () => {
    mockSearch({ data: ONE_MATCH });
    renderField();

    expect(screen.getByText('House number')).toBeDefined();
  });

  // The distinction the whole result shape exists for.
  it('separates "nothing matched" from "we could not ask"', () => {
    mockSearch({ data: { items: [], providerAvailable: true } });
    renderField();
    expect(screen.getByText(/No address matched/u)).toBeDefined();

    mockSearch({ data: { items: [], providerAvailable: false } });
    renderField();
    expect(screen.getByText(/did not answer/u)).toBeDefined();
  });
});
