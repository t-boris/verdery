import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantReferenceGallery } from './plant-reference-gallery';
import { usePlantTaxonProfile } from './queries';

vi.mock('./queries', () => ({ usePlantTaxonProfile: vi.fn() }));

const mockedUsePlantTaxonProfile = vi.mocked(usePlantTaxonProfile);

function renderGallery() {
  return render(
    <LocalizationProvider locale="en">
      <PlantReferenceGallery
        taxonomyReferenceId="019fda00-0000-7000-8000-000000000002"
        displayName="Green Ash"
      />
    </LocalizationProvider>,
  );
}

describe('PlantReferenceGallery', () => {
  it('shows licensed reference imagery with attribution', () => {
    mockedUsePlantTaxonProfile.mockReturnValue({
      data: {
        profile: null,
        images: [
          {
            id: '019fda00-0000-7000-8000-000000000001',
            sourceUrl: 'https://images.example.org/species.jpg',
            license: 'cc_by',
            attribution: 'Photographer / GBIF',
            organ: 'leaf',
          },
        ],
      },
      isPending: false,
      isError: false,
    } as never);

    renderGallery();

    expect(screen.getByRole('heading', { name: 'Reference photos' })).not.toBeNull();
    expect(
      screen.getByRole('img', { name: 'Green Ash — reference photo 1' }).getAttribute('src'),
    ).toBe('https://images.example.org/species.jpg');
    expect(screen.getByText('Photographer / GBIF')).not.toBeNull();
  });

  it('opens the complete reference image in a full-screen dialog and closes it', () => {
    mockedUsePlantTaxonProfile.mockReturnValue({
      data: {
        profile: null,
        images: [
          {
            id: '019fda00-0000-7000-8000-000000000001',
            sourceUrl: 'https://images.example.org/species.jpg',
            license: 'cc_by',
            attribution: 'Photographer / GBIF',
            organ: null,
          },
        ],
      },
      isPending: false,
      isError: false,
    } as never);

    renderGallery();
    fireEvent.click(screen.getByRole('button', { name: 'Green Ash — reference photo 1' }));

    expect(screen.getByRole('dialog', { name: 'Reference photos' })).not.toBeNull();
    expect(screen.getAllByRole('img', { name: 'Green Ash — reference photo 1' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Close full-screen photo' }));
    expect(screen.queryByRole('dialog', { name: 'Reference photos' })).toBeNull();
  });

  it('explains when no licensed reference imagery exists', () => {
    mockedUsePlantTaxonProfile.mockReturnValue({
      data: { profile: null, images: [] },
      isPending: false,
      isError: false,
    } as never);

    renderGallery();

    expect(
      screen.getByText('No licensed reference photos are available for this species yet.'),
    ).not.toBeNull();
  });
});
