import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PlantReferenceGallery } from './plant-reference-gallery';
import { usePlantTaxonProfile } from './queries';

vi.mock('./queries', () => ({ usePlantTaxonProfile: vi.fn() }));

describe('PlantReferenceGallery', () => {
  it('shows licensed provider images separately with required attribution', () => {
    vi.mocked(usePlantTaxonProfile).mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        profile: null,
        images: [
          {
            id: 'image-1',
            sourceUrl: 'https://images.example/ash.jpg',
            license: 'cc_by',
            attribution: 'A. Botanist',
            organ: null,
          },
        ],
      },
    } as never);

    render(
      <LocalizationProvider locale="en">
        <PlantReferenceGallery taxonomyReferenceId="taxon-1" />
      </LocalizationProvider>,
    );

    expect(screen.getByRole('img').getAttribute('src')).toBe('https://images.example/ash.jpg');
    expect(screen.getByText('A. Botanist')).toBeTruthy();
  });
});
