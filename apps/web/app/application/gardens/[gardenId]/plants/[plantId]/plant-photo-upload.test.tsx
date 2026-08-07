import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useIsOnline } from '@/core/connectivity/public';
import { useMediaUpload } from '@/features/media/public';
import { useAttachPlantPhoto } from '@/features/plants/public';
import { LocalizationProvider } from '@/shared/localization/public';

import { PlantPhotoUpload } from './plant-photo-upload';

vi.mock('@/core/connectivity/public', () => ({ useIsOnline: vi.fn() }));
vi.mock('@/features/media/public', () => ({ formatBytes: vi.fn(), useMediaUpload: vi.fn() }));
vi.mock('@/features/plants/public', () => ({ useAttachPlantPhoto: vi.fn() }));

describe('PlantPhotoUpload', () => {
  it('attaches an available uploaded media record to the existing plant', () => {
    vi.mocked(useIsOnline).mockReturnValue(true);
    vi.mocked(useMediaUpload).mockReturnValue({
      phase: 'processed',
      mediaId: 'media-1',
      media: { uploadState: 'available' },
      displayFilename: 'ash.jpg',
      uploadedBytes: 10,
      totalBytes: 10,
      cancel: vi.fn(),
    } as never);
    const mutate = vi.fn();
    vi.mocked(useAttachPlantPhoto).mockReturnValue({
      mutate,
      reset: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
    } as never);

    render(
      <LocalizationProvider locale="en">
        <PlantPhotoUpload gardenId="garden-1" plantId="plant-1" />
      </LocalizationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Attach photo' }));

    expect(mutate).toHaveBeenCalledWith({ mediaId: 'media-1' }, expect.any(Object));
  });
});
