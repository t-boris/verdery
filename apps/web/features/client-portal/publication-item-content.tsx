'use client';

import type { PublicationItemKind, PublicationMediaRole } from '@verdery/api-contracts';

import { useLocalization } from '@/shared/localization/public';
import { StatusPill } from '@/shared/ui/public';

import { ClientMediaImage } from './client-media-image';
import { mediaRoleLabel } from './labels';
import styles from './publication-item-content.module.css';
import { SnapshotDataList } from './snapshot-data-list';

export interface PublicationItemContentProps {
  /**
   * The publication version this item belongs to — `ClientPublicationItem`
   * carries no `publicationId` of its own (it is already nested under one
   * summary), so the publications view passes the summary's own `id`; a
   * timeline entry carries its `publicationId` directly and passes that.
   * Either way, `getClientMediaAccess` needs it to build its own URL.
   */
  readonly publicationId: string;
  readonly kind: PublicationItemKind;
  readonly description?: string | undefined;
  readonly mediaId?: string | undefined;
  readonly mediaRole?: PublicationMediaRole | undefined;
  readonly caption?: string | undefined;
  readonly overviewText?: string | undefined;
  readonly snapshotData?: Readonly<Record<string, unknown>> | undefined;
  readonly entryText?: string | undefined;
}

/**
 * Renders one item's content by `kind` — the one piece of rendering shared
 * between the publications view and the Garden Timeline, since both read
 * the identical underlying facts (`getClientTimeline`'s own description:
 * "the SAME visible ... items `listClientPublications` reads, reshaped").
 * Their surrounding STRUCTURE differs deliberately (version-grouped cards
 * versus one flat chronological list) — see `client-timeline.tsx`'s own doc
 * comment — but a `work_log` item's description, a `media` item's photo, a
 * `garden_snapshot`'s text, and a `timeline_entry`'s note are the same
 * content regardless of which view is showing them.
 *
 * Source: packages/api-contracts/openapi.yaml, schemas `ClientPublicationItem`,
 * `ClientTimelineEntry`.
 */
export function PublicationItemContent({
  publicationId,
  kind,
  description,
  mediaId,
  mediaRole,
  caption,
  overviewText,
  snapshotData,
  entryText,
}: PublicationItemContentProps) {
  const { t } = useLocalization();

  if (kind === 'work_log') {
    return description === undefined ? null : <p className={styles['text']}>{description}</p>;
  }

  if (kind === 'media') {
    if (mediaId === undefined) {
      return null;
    }
    const roleText =
      mediaRole === undefined ? t('clientPortal.kindMedia') : t(mediaRoleLabel(mediaRole));
    return (
      <div className={styles['mediaBlock']}>
        {mediaRole !== undefined && <StatusPill tone="neutral" label={roleText} />}
        <ClientMediaImage
          publicationId={publicationId}
          mediaId={mediaId}
          alt={caption ?? t('clientPortal.mediaAlt', { role: roleText })}
        />
        {caption !== undefined && <p className={styles['caption']}>{caption}</p>}
      </div>
    );
  }

  if (kind === 'garden_snapshot') {
    return (
      <div className={styles['snapshotBlock']}>
        {overviewText !== undefined && <p className={styles['text']}>{overviewText}</p>}
        {snapshotData !== undefined && <SnapshotDataList data={snapshotData} />}
      </div>
    );
  }

  // kind === 'timeline_entry'
  return entryText === undefined ? null : <p className={styles['text']}>{entryText}</p>;
}
