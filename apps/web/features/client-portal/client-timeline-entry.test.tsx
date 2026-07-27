import type { ClientTimelineEntry as ClientTimelineEntryData } from '@verdery/api-contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocalizationProvider } from '@/shared/localization/public';

import { ClientTimelineEntry } from './client-timeline-entry';

const ENTRY: ClientTimelineEntryData = {
  publicationId: 'publication-1',
  kind: 'work_log',
  occurredAt: '2026-07-10T09:00:00Z',
  description: 'Re-mulched the north bed.',
};

function renderEntry(entry: ClientTimelineEntryData = ENTRY) {
  return render(
    <LocalizationProvider locale="en">
      <ClientTimelineEntry entry={entry} />
    </LocalizationProvider>,
  );
}

describe('ClientTimelineEntry', () => {
  it('renders a timestamped row with a kind badge — no title, no version grouping', () => {
    renderEntry();

    expect(screen.getByText('Completed work')).toBeTruthy();
    expect(screen.getByText('Re-mulched the north bed.')).toBeTruthy();
    const time = document.querySelector('time');
    expect(time?.getAttribute('dateTime')).toBe('2026-07-10T09:00:00Z');
  });

  it('labels a garden_snapshot fact distinctly from a work_log one', () => {
    renderEntry({
      publicationId: 'publication-1',
      kind: 'garden_snapshot',
      occurredAt: '2026-07-10T09:00:00Z',
      overviewText: 'The garden is fully established.',
    });

    expect(screen.getByText('Garden overview')).toBeTruthy();
  });
});
