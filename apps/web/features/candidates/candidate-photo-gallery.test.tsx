import type { PlantCandidatePhoto } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { useCandidatePhotoAccess } from './candidate-media-queries';
import { CandidatePhotoGallery } from './candidate-photo-gallery';
import { useCandidatePhotos } from './queries';

vi.mock('./queries', () => ({ useCandidatePhotos: vi.fn() }));
vi.mock('./candidate-media-queries', () => ({ useCandidatePhotoAccess: vi.fn() }));

const mockedUseCandidatePhotos = vi.mocked(useCandidatePhotos);
const mockedUseCandidatePhotoAccess = vi.mocked(useCandidatePhotoAccess);

const PHOTO: PlantCandidatePhoto = {
  id: 'photo-1',
  candidateId: 'candidate-1',
  mediaId: 'media-1',
  isPrimary: true,
  createdAt: '2026-07-21T09:00:00Z',
};

function renderGallery() {
  return render(
    <LocalizationProvider locale="en">
      <CandidatePhotoGallery gardenId="garden-1" candidateId="candidate-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CandidatePhotoGallery', () => {
  it('opens the complete photo in a full-viewport dialog and closes it with Escape', () => {
    mockedUseCandidatePhotos.mockReturnValue({
      isPending: false,
      isError: false,
      data: [PHOTO],
    } as never);
    mockedUseCandidatePhotoAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/media-1', expiresAt: '2026-01-01T00:00:00Z' },
    });

    renderGallery();

    fireEvent.click(screen.getByRole('button', { name: 'Open photo full screen' }));
    expect(screen.getByRole('dialog', { name: 'Photo' })).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
