import type { MediaDerivativeSummary } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { MediaPreview } from './media-preview';
import { useMediaAccess } from './queries';

vi.mock('./queries', () => ({ useMediaAccess: vi.fn() }));

const mockedUseMediaAccess = vi.mocked(useMediaAccess);

const SCREEN_PREVIEW: MediaDerivativeSummary = {
  derivativeKind: 'screen_preview',
  mediaId: 'derivative-screen-1',
};
const THUMBNAIL: MediaDerivativeSummary = {
  derivativeKind: 'thumbnail',
  mediaId: 'derivative-thumb-1',
};

function renderPreview(derivatives: readonly MediaDerivativeSummary[]) {
  return render(
    <LocalizationProvider locale="en">
      <MediaPreview
        gardenId="garden-1"
        mediaId="original-1"
        processingState="processed"
        displayFilename="photo.heic"
        derivatives={derivatives}
      />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('MediaPreview derivative selection', () => {
  it('requests access for the screen_preview derivative, not the original', () => {
    mockedUseMediaAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/screen', expiresAt: '2026-01-01T00:00:00Z' },
    } as never);

    renderPreview([THUMBNAIL, SCREEN_PREVIEW]);

    expect(mockedUseMediaAccess).toHaveBeenCalledWith('garden-1', 'derivative-screen-1', true);
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://signed.example/screen');
  });

  it('falls back to the thumbnail when no screen preview exists', () => {
    mockedUseMediaAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/thumb', expiresAt: '2026-01-01T00:00:00Z' },
    } as never);

    renderPreview([THUMBNAIL]);

    expect(mockedUseMediaAccess).toHaveBeenCalledWith('garden-1', 'derivative-thumb-1', true);
  });

  it('falls back to the original itself when no derivatives exist', () => {
    mockedUseMediaAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/original', expiresAt: '2026-01-01T00:00:00Z' },
    } as never);

    renderPreview([]);

    expect(mockedUseMediaAccess).toHaveBeenCalledWith('garden-1', 'original-1', true);
  });
});
