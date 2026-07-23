import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { CreateManualTaskForm } from './create-manual-task-form';

const mutateMock = vi.fn();

// `./queries` talks to the real API through `core/api`; mocked here so this
// test exercises only the form's own draft-recovery and offline-gating
// behavior, the way this codebase already mocks the module boundary of a
// component under test rather than standing up a full HTTP layer.
vi.mock('./queries', () => ({
  useCreateManualTask: () => ({
    mutate: mutateMock,
    isPending: false,
    isError: false,
  }),
}));

function renderForm() {
  return render(
    <LocalizationProvider locale="en">
      <CreateManualTaskForm gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  mutateMock.mockClear();
  act(() => onlineManager.setOnline(true));
});

describe('CreateManualTaskForm — recoverable local draft', () => {
  it('survives a simulated reload: typed input is recovered after unmount/remount against the same storage', () => {
    vi.useFakeTimers();

    const { unmount } = renderForm();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Weed the north bed' },
    });

    // Let the draft-persistence hook's debounced write reach storage before
    // the "reload".
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();

    unmount();

    renderForm();

    expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('Weed the north bed');
    expect(screen.getByText('Unsaved work recovered')).toBeTruthy();
  });

  it('does not recover anything for a form that was never touched', () => {
    const { unmount } = renderForm();
    unmount();

    renderForm();

    expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('');
    expect(screen.queryByText('Unsaved work recovered')).toBeNull();
  });

  it('discarding the recovered draft clears the field and removes the notice', () => {
    vi.useFakeTimers();
    const { unmount } = renderForm();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weed the north bed' } });
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    unmount();

    renderForm();
    fireEvent.click(screen.getByText('Discard recovered draft'));

    expect(screen.getByLabelText<HTMLInputElement>('Title').value).toBe('');
    expect(screen.queryByText('Unsaved work recovered')).toBeNull();
  });
});

describe('CreateManualTaskForm — offline behavior', () => {
  it('shows the stale indicator and disables submission while offline, then re-enables it on reconnect without auto-resubmitting', () => {
    renderForm();
    expect(screen.queryByText('You are offline')).toBeNull();

    act(() => onlineManager.setOnline(false));

    expect(screen.getByText('You are offline')).toBeTruthy();
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Create task' });
    expect(submit.disabled).toBe(true);

    act(() => onlineManager.setOnline(true));

    expect(screen.queryByText('You are offline')).toBeNull();
    expect(submit.disabled).toBe(false);
    // Reconnecting alone must never trigger a submission on the user's
    // behalf — only their own click does.
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
