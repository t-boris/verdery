import type { ClientPublicationSummary } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientPublicationCard } from './client-publication-card';
import { useClientMediaAccess } from './queries';

vi.mock('./queries', () => ({ useClientMediaAccess: vi.fn() }));

const mockedUseAccess = vi.mocked(useClientMediaAccess);

const PUBLICATION: ClientPublicationSummary = {
  id: 'publication-1',
  versionNumber: 3,
  title: 'Spring refresh',
  summary: 'Beds re-mulched and irrigation repaired.',
  publishedAt: '2026-07-12T09:00:00Z',
  items: [
    {
      id: 'item-1',
      kind: 'work_log',
      occurredAt: '2026-07-10T09:00:00Z',
      description: 'Re-mulched the north bed.',
    },
    {
      id: 'item-2',
      kind: 'media',
      occurredAt: '2026-07-10T10:00:00Z',
      mediaId: 'media-1',
      mediaRole: 'after',
      caption: 'The bed after mulching.',
    },
  ],
  staffAttributions: [{ id: 'staff-1', displayName: 'Jordan Ruiz', roleLabel: 'Lead gardener' }],
};

function renderCard(publication: ClientPublicationSummary = PUBLICATION) {
  return render(
    <LocalizationProvider locale="en">
      <ClientPublicationCard publication={publication} />
    </LocalizationProvider>,
  );
}

describe('ClientPublicationCard', () => {
  it('renders the title, version, publishedAt, and summary — no edit/comment/reply affordance', () => {
    mockedUseAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/after.jpg', expiresAt: '2026-07-21T09:15:00Z' },
    } as unknown as ReturnType<typeof useClientMediaAccess>);

    renderCard();

    expect(screen.getByRole('heading', { name: 'Spring refresh' })).toBeTruthy();
    expect(screen.getByText('Update 3')).toBeTruthy();
    expect(screen.getByText(/^Published /)).toBeTruthy();
    expect(screen.getByText('Beds re-mulched and irrigation repaired.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders every item snapshot, including a before/after media item', () => {
    mockedUseAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/after.jpg', expiresAt: '2026-07-21T09:15:00Z' },
    } as unknown as ReturnType<typeof useClientMediaAccess>);

    renderCard();

    expect(screen.getByText('Re-mulched the north bed.')).toBeTruthy();
    expect(screen.getByText('After')).toBeTruthy();
    const image = screen.getByRole('img', { name: 'The bed after mulching.' });
    expect(image.getAttribute('src')).toBe('https://signed.example/after.jpg');
  });

  it('renders the selected staff display attribution', () => {
    mockedUseAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/after.jpg', expiresAt: '2026-07-21T09:15:00Z' },
    } as unknown as ReturnType<typeof useClientMediaAccess>);

    renderCard();

    expect(screen.getByText(/Jordan Ruiz/)).toBeTruthy();
    expect(screen.getByText(/Lead gardener/)).toBeTruthy();
  });

  it('omits the team section entirely when no staff attribution was selected for publication', () => {
    mockedUseAccess.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://signed.example/after.jpg', expiresAt: '2026-07-21T09:15:00Z' },
    } as unknown as ReturnType<typeof useClientMediaAccess>);

    renderCard({ ...PUBLICATION, staffAttributions: [] });

    expect(screen.queryByText('Team')).toBeNull();
  });
});
