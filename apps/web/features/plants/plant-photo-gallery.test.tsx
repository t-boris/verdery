import type { PlantPhoto } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantPhotoGallery } from './plant-photo-gallery';
import { usePlantPhotoAccess } from './plant-media-queries';
import { usePlantPhotos, useSetPrimaryPlantPhoto } from './queries';

vi.mock('./queries', () => ({ usePlantPhotos: vi.fn(), useSetPrimaryPlantPhoto: vi.fn() }));
vi.mock('./plant-media-queries', () => ({ usePlantPhotoAccess: vi.fn() }));

const mockedUsePlantPhotos = vi.mocked(usePlantPhotos);
const mockedUseSetPrimaryPlantPhoto = vi.mocked(useSetPrimaryPlantPhoto);
const mockedUsePlantPhotoAccess = vi.mocked(usePlantPhotoAccess);

const PHOTO: PlantPhoto = {
  id: 'photo-1',
  plantId: 'plant-1',
  mediaId: 'media-1',
  isPrimary: true,
  createdAt: '2026-07-21T09:00:00Z',
};

function renderGallery() {
  return render(
    <LocalizationProvider locale="en">
      <PlantPhotoGallery gardenId="garden-1" plantId="plant-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

mockedUseSetPrimaryPlantPhoto.mockReturnValue({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
} as never);

describe('PlantPhotoGallery', () => {
  it('renders nothing while the photo list is loading', () => {
    mockedUsePlantPhotos.mockReturnValue({ isPending: true, isError: false } as never);

    const { container } = renderGallery();

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the plant has no photos', () => {
    mockedUsePlantPhotos.mockReturnValue({ isPending: false, isError: false, data: [] } as never);

    const { container } = renderGallery();

    expect(container.firstChild).toBeNull();
  });

  it('renders one thumbnail per photo, sourced from its resolved access URL', () => {
    mockedUsePlantPhotos.mockReturnValue({
      isPending: false,
      isError: false,
      data: [PHOTO],
    } as never);
    mockedUsePlantPhotoAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/media-1', expiresAt: '2026-01-01T00:00:00Z' },
    });

    renderGallery();

    expect(mockedUsePlantPhotoAccess).toHaveBeenCalledWith('garden-1', 'media-1');
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://signed.example/media-1');
  });

  it('opens the specimen photo in a full-screen dialog', () => {
    mockedUsePlantPhotos.mockReturnValue({
      isPending: false,
      isError: false,
      data: [PHOTO],
    } as never);
    mockedUsePlantPhotoAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/media-1', expiresAt: '2026-01-01T00:00:00Z' },
    });

    renderGallery();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo full screen' }));

    expect(screen.getByRole('dialog', { name: 'Primary photo' })).toBeTruthy();
  });
});
