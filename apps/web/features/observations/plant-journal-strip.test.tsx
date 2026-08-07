import type { PlantJournalFrame } from '@verdery/api-contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { useJournalFrameAccess, usePlantJournalFrames } from './journal-queries';
import { PlantJournalStrip } from './plant-journal-strip';

vi.mock('./journal-queries', () => ({
  usePlantJournalFrames: vi.fn(),
  useJournalFrameAccess: vi.fn(),
}));

const mockedUseFrames = vi.mocked(usePlantJournalFrames);
const mockedUseAccess = vi.mocked(useJournalFrameAccess);

const FRAMES: readonly PlantJournalFrame[] = [
  {
    observationId: 'observation-1',
    mediaId: 'media-1',
    observedAt: '2026-03-02T08:00:00Z',
    purpose: 'whole_plant',
  },
  {
    observationId: 'observation-2',
    mediaId: 'media-2',
    observedAt: '2026-06-02T08:00:00Z',
    purpose: null,
  },
];

function renderStrip() {
  return render(
    <LocalizationProvider locale="en">
      <PlantJournalStrip gardenId="garden-1" plantId="plant-1" />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('PlantJournalStrip', () => {
  it('renders one frame per photograph, sourced from its resolved access URL', () => {
    mockedUseFrames.mockReturnValue({ isError: false, data: { items: FRAMES } } as never);
    mockedUseAccess.mockReturnValue({
      data: { url: 'https://storage.example.test/frame', expiresAt: '2026-06-02T09:00:00Z' },
      isPending: false,
      isError: false,
    });

    renderStrip();

    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute('src')).toBe('https://storage.example.test/frame');
  });

  it('names the shot in a frame’s alt text, and falls back to the date alone when it has no purpose', () => {
    mockedUseFrames.mockReturnValue({ isError: false, data: { items: FRAMES } } as never);
    mockedUseAccess.mockReturnValue({
      data: { url: 'https://storage.example.test/frame', expiresAt: '2026-06-02T09:00:00Z' },
      isPending: false,
      isError: false,
    });

    renderStrip();

    // An unlabelled photograph is described by when it was taken rather than
    // being given a purpose it never carried.
    expect(screen.getByRole('img', { name: /Whole plant/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Photograph observed/ })).toBeTruthy();
  });

  it('shows a placeholder rather than a broken image while a frame is still processing', () => {
    mockedUseFrames.mockReturnValue({
      isError: false,
      data: { items: [FRAMES[0]] },
    } as never);
    mockedUseAccess.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });

    renderStrip();

    expect(screen.queryByRole('img')).toBeNull();
  });

  it('asks for one purpose once the reader picks one', () => {
    mockedUseFrames.mockReturnValue({ isError: false, data: { items: FRAMES } } as never);
    mockedUseAccess.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderStrip();
    // The unnarrowed default is the mixture: it is the only setting that shows
    // photographs carrying no purpose label at all.
    expect(mockedUseFrames).toHaveBeenLastCalledWith('garden-1', 'plant-1', { purpose: null });

    fireEvent.click(screen.getByRole('button', { name: 'Leaf, front' }));

    expect(mockedUseFrames).toHaveBeenLastCalledWith('garden-1', 'plant-1', {
      purpose: 'leaf_front',
    });
  });

  it('distinguishes an empty plant from an empty filter', () => {
    mockedUseFrames.mockReturnValue({ isError: false, data: { items: [] } } as never);
    mockedUseAccess.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderStrip();
    expect(screen.getByText('No photographs have been attached to this plant yet.')).toBeTruthy();

    // The second message is the one a reader can act on: it names the filter
    // as the reason, so they know to widen it rather than conclude the plant
    // has no history.
    fireEvent.click(screen.getByRole('button', { name: 'Fruit' }));

    expect(
      screen.getByText('No photographs of this kind yet. Try another shot type.'),
    ).toBeTruthy();
  });
});
