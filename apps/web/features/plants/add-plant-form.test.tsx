import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { AddPlantForm } from './add-plant-form';

const mutateMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mocked once for both `add-plant-form.tsx`'s own `useAddPlant` and
// `taxonomy-reference-field.tsx`'s `useTaxonomyReferenceSearch` — both
// resolve `./queries` to the same module from this directory.
vi.mock('./queries', () => ({
  useAddPlant: () => ({ mutate: mutateMock, isPending: false, isError: false }),
  useTaxonomyReferenceSearch: () => ({
    data: {
      items: [
        {
          id: 'taxonomy-42',
          scientificName: 'Solanum lycopersicum',
          commonName: 'Tomato',
          varietyName: null,
        },
      ],
    },
    isError: false,
  }),
}));

function renderForm() {
  return render(
    <LocalizationProvider locale="en">
      <AddPlantForm gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  mutateMock.mockClear();
  act(() => onlineManager.setOnline(true));
});

describe('AddPlantForm — recoverable local draft', () => {
  it('recovers both React Hook Form fields and the taxonomy selection (state RHF does not own) after a simulated reload', () => {
    vi.useFakeTimers();

    const { unmount } = renderForm();
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Cherry tomato' },
    });
    fireEvent.change(screen.getByLabelText('Taxonomy reference'), {
      target: { value: 'taxonomy-42' },
    });
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    unmount();

    renderForm();

    expect(screen.getByLabelText<HTMLInputElement>('Display name').value).toBe('Cherry tomato');
    expect(screen.getByLabelText<HTMLSelectElement>('Taxonomy reference').value).toBe(
      'taxonomy-42',
    );
    expect(screen.getByText('Unsaved work recovered')).toBeTruthy();
  });
});

describe('AddPlantForm — offline behavior', () => {
  it('disables submission while offline and re-enables it on reconnect without auto-submitting', () => {
    renderForm();

    act(() => onlineManager.setOnline(false));
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Add plant' });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('You are offline')).toBeTruthy();

    act(() => onlineManager.setOnline(true));
    expect(submit.disabled).toBe(false);
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
