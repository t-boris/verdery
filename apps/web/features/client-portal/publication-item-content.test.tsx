import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { PublicationItemContent } from './publication-item-content';
import { useClientMediaAccess } from './queries';

vi.mock('./queries', () => ({ useClientMediaAccess: vi.fn() }));

const mockedUseAccess = vi.mocked(useClientMediaAccess);

function renderContent(props: Partial<ComponentProps<typeof PublicationItemContent>>) {
  return render(
    <LocalizationProvider locale="en">
      <PublicationItemContent publicationId="publication-1" kind="work_log" {...props} />
    </LocalizationProvider>,
  );
}

describe('PublicationItemContent', () => {
  it('renders a work_log item as its curated client-safe description', () => {
    renderContent({ kind: 'work_log', description: 'Re-mulched the north bed.' });

    expect(screen.getByText('Re-mulched the north bed.')).toBeTruthy();
  });

  it('renders a media item as an image with its role badge and caption', () => {
    mockedUseAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/before.jpg', expiresAt: '2026-07-21T09:15:00Z' },
    } as unknown as ReturnType<typeof useClientMediaAccess>);

    renderContent({
      kind: 'media',
      mediaId: 'media-1',
      mediaRole: 'before',
      caption: 'The bed before mulching.',
    });

    expect(screen.getByText('Before')).toBeTruthy();
    expect(screen.getByText('The bed before mulching.')).toBeTruthy();
    const image = screen.getByRole('img', { name: 'The bed before mulching.' });
    expect(image.getAttribute('src')).toBe('https://signed.example/before.jpg');
  });

  it('falls back to a role-based alt text when a media item has no caption', () => {
    mockedUseAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/after.jpg', expiresAt: '2026-07-21T09:15:00Z' },
    } as unknown as ReturnType<typeof useClientMediaAccess>);

    renderContent({ kind: 'media', mediaId: 'media-2', mediaRole: 'after' });

    expect(screen.getByRole('img', { name: 'After photo' })).toBeTruthy();
  });

  it('renders a garden_snapshot item as its overview text plus structured supplement', () => {
    renderContent({
      kind: 'garden_snapshot',
      overviewText: 'The garden is fully established.',
      snapshotData: { bedsCount: 3 },
    });

    expect(screen.getByText('The garden is fully established.')).toBeTruthy();
    expect(screen.getByText('bedsCount')).toBeTruthy();
  });

  it('renders a timeline_entry item as its plain entry text', () => {
    renderContent({ kind: 'timeline_entry', entryText: 'First frost of the season.' });

    expect(screen.getByText('First frost of the season.')).toBeTruthy();
  });
});
