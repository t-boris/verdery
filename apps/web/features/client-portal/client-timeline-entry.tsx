'use client';

import type { ClientTimelineEntry as ClientTimelineEntryData } from '@verdery/api-contracts';

import { formatInstant, useLocalization } from '@/shared/localization/public';
import { StatusPill } from '@/shared/ui/public';

import styles from './client-timeline-entry.module.css';
import { itemKindLabel } from './labels';
import { PublicationItemContent } from './publication-item-content';

/**
 * One fact in the factual Garden Timeline — a flat row, not a card grouped
 * under a publication version: no title, no summary, no staff attribution,
 * unlike `ClientPublicationCard`. Every entry carries its own `kind` badge
 * because, with no version heading to group similar facts together, the
 * badge is what tells "completed work" apart from "photo" apart from
 * "garden overview" apart from "note" at a glance, per
 * collaboration-and-client-sharing.md section 12.1's own description of
 * this view as "a factual narrative of what happened and when".
 */
export function ClientTimelineEntry({ entry }: { readonly entry: ClientTimelineEntryData }) {
  const { t, locale } = useLocalization();

  return (
    <li className={styles['entry']}>
      <div className={styles['header']}>
        <time className={styles['time']} dateTime={entry.occurredAt}>
          {formatInstant(entry.occurredAt, locale)}
        </time>
        <StatusPill tone="neutral" label={t(itemKindLabel(entry.kind))} />
      </div>
      <PublicationItemContent
        publicationId={entry.publicationId}
        kind={entry.kind}
        description={entry.description}
        mediaId={entry.mediaId}
        mediaRole={entry.mediaRole}
        caption={entry.caption}
        overviewText={entry.overviewText}
        snapshotData={entry.snapshotData}
        entryText={entry.entryText}
        narrativeText={entry.narrativeText}
      />
    </li>
  );
}
