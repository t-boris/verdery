import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { InviteForm } from './invite-form';
import { useCreateInvitation } from './queries';

vi.mock('./queries', () => ({
  useCreateInvitation: vi.fn(),
}));

const mockedUseCreateInvitation = vi.mocked(useCreateInvitation);

const CREATED = {
  id: 'invitation-1',
  gardenId: 'garden-1',
  inviterProfileId: 'profile-owner',
  intendedRole: 'editor' as const,
  state: 'pending' as const,
  createdAt: '2026-07-21T09:00:00Z',
  expiresAt: '2026-07-28T09:00:00Z',
  token: 'a'.repeat(40),
};

function renderForm() {
  return render(
    <LocalizationProvider locale="en">
      <InviteForm gardenId="garden-1" />
    </LocalizationProvider>,
  );
}

function mockSucceedingCreation() {
  mockedUseCreateInvitation.mockReturnValue({
    mutate: (_input: unknown, options: { onSuccess: (result: typeof CREATED) => void }) =>
      options.onSuccess(CREATED),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useCreateInvitation>);
}

let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InviteForm — creating an invitation', () => {
  it('submits the selected role and omits an empty email', async () => {
    const mutate = vi.fn();
    mockedUseCreateInvitation.mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useCreateInvitation>);

    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    await vi.waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0]?.[0]).toEqual({ intendedRole: 'editor' });
  });

  it('reveals the one-time link once creation succeeds, and hides the form', async () => {
    mockSucceedingCreation();

    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    await vi.waitFor(() =>
      expect(screen.getByDisplayValue(new RegExp(`token=${CREATED.token}$`))).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: 'Create invitation' })).toBeNull();
  });

  it('copies the link to the clipboard and confirms it', async () => {
    mockSucceedingCreation();

    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    await vi.waitFor(() => screen.getByRole('button', { name: 'Copy link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await vi.waitFor(() => expect(screen.getByText('Copied.')).toBeTruthy());
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining(`token=${CREATED.token}`));
  });

  it('returns to the form when "Done" is pressed', async () => {
    mockSucceedingCreation();

    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    await vi.waitFor(() => screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.getByRole('button', { name: 'Create invitation' })).toBeTruthy();
  });

  it('shows a failure alert when creation fails', () => {
    const failure = {
      ok: false as const,
      kind: 'contract' as const,
      code: 'collaboration.invitation.already_pending',
      fallbackMessage: 'An invitation is already pending.',
      correlationId: 'corr-1',
      retryable: false,
      details: [],
      status: 409,
    };
    mockedUseCreateInvitation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: { failure },
    } as unknown as ReturnType<typeof useCreateInvitation>);

    renderForm();

    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
