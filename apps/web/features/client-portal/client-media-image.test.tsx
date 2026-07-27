import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientMediaImage } from './client-media-image';
import { useClientMediaAccess } from './queries';

vi.mock('./queries', () => ({ useClientMediaAccess: vi.fn() }));

const mockedUseAccess = vi.mocked(useClientMediaAccess);

function mockAccessQuery(fields: Record<string, unknown>): void {
  mockedUseAccess.mockReturnValue(fields as unknown as ReturnType<typeof useClientMediaAccess>);
}

const TRANSPORT_FAILURE = {
  ok: false as const,
  kind: 'transport' as const,
  code: 'client.transport_failure',
  fallbackMessage: 'The API could not be reached.',
  correlationId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b',
  retryable: true,
  details: [],
  status: null,
};

function renderImage() {
  return render(
    <LocalizationProvider locale="en">
      <ClientMediaImage
        publicationId="publication-1"
        mediaId="media-1"
        alt="After photo of the north bed"
      />
    </LocalizationProvider>,
  );
}

describe('ClientMediaImage', () => {
  it('shows a loading indicator while access is being authorized', () => {
    mockAccessQuery({ isPending: true, isError: false });

    renderImage();

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders a plain img with the short-lived signed url and the given alt text', () => {
    mockAccessQuery({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/media-1', expiresAt: '2026-07-21T09:15:00Z' },
    });

    renderImage();

    const image = screen.getByRole('img', { name: 'After photo of the north bed' });
    expect(image.getAttribute('src')).toBe('https://signed.example/media-1');
  });

  it('shows a failure alert when access is denied — e.g. entitlement withdrawn since page load', () => {
    mockAccessQuery({
      isPending: false,
      isError: true,
      error: { failure: TRANSPORT_FAILURE },
    });

    renderImage();

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('requests fresh access scoped by publicationId and mediaId, never a cached prior verdict', () => {
    mockAccessQuery({ isPending: true, isError: false });

    renderImage();

    expect(mockedUseAccess).toHaveBeenCalledWith('publication-1', 'media-1');
  });
});
