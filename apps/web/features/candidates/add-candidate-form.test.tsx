import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { AddCandidateForm } from './add-candidate-form';

const mutateMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./queries', () => ({
  useAddCandidate: () => ({ mutate: mutateMock, isPending: false, isError: false }),
}));

vi.mock('./taxonomy-queries', () => ({
  useTaxonomyReferenceSearch: () => ({
    data: {
      items: [
        {
          id: 'taxonomy-42',
          scientificName: 'Ficus carica',
          commonName: 'Fig',
          varietyName: null,
        },
      ],
    },
    isError: false,
  }),
}));

vi.mock('./map-object-queries', () => ({
  useGardenMapObjects: () => ({ data: [], isPending: false, isError: false }),
}));

function renderForm() {
  return render(
    <LocalizationProvider locale="en">
      <AddCandidateForm gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  mutateMock.mockClear();
  act(() => onlineManager.setOnline(true));
});

describe('AddCandidateForm — recoverable local draft', () => {
  it('recovers both React Hook Form fields and the taxonomy selection (state RHF does not own) after a simulated reload', () => {
    vi.useFakeTimers();

    const { unmount } = renderForm();
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Fig tree' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Taxonomy reference' }));
    fireEvent.click(screen.getByRole('button', { name: /Ficus carica/ }));
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    unmount();

    renderForm();

    expect(screen.getByLabelText<HTMLInputElement>('Display name').value).toBe('Fig tree');
    fireEvent.click(screen.getByRole('button', { name: 'Taxonomy reference' }));
    expect(screen.getByRole('button', { name: /Ficus carica/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('Unsaved work recovered')).toBeTruthy();
  });
});

describe('AddCandidateForm — offline behavior', () => {
  it('disables submission while offline and re-enables it on reconnect without auto-submitting', () => {
    renderForm();

    act(() => onlineManager.setOnline(false));
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Add candidate' });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('You are offline')).toBeTruthy();

    act(() => onlineManager.setOnline(true));
    expect(submit.disabled).toBe(false);
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
