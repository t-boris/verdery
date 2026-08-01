'use client';

import type { ClientPublicationSummary } from '@verdery/api-contracts';

import { formatInstant, useLocalization } from '@/shared/localization/public';
import { Card } from '@/shared/ui/public';

import styles from './client-publication-card.module.css';
import { PublicationItemContent } from './publication-item-content';

/**
 * One published version, grouped exactly as the contract groups it: a
 * client-safe title/summary, its own item snapshots, and the staff display
 * attribution selected for that publication — never flattened out of its
 * version, unlike `client-timeline.tsx`'s own rendering of the identical
 * underlying items.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "11. Publication Contents".
 */
export function ClientPublicationCard({
  publication,
}: {
  readonly publication: ClientPublicationSummary;
}) {
  const { t, locale } = useLocalization();

  return (
    <li className={styles['listItem']}>
      <Card title={publication.title}>
        <div className={styles['meta']}>
          <span className={styles['version']}>
            {t('clientPortal.publicationVersionLabel', { version: publication.versionNumber })}
          </span>
          <span className={styles['publishedAt']}>
            {t('clientPortal.publicationPublishedAt', {
              date: formatInstant(publication.publishedAt, locale),
            })}
          </span>
        </div>

        <p className={styles['summary']}>{publication.summary}</p>

        {publication.staffAttributions.length > 0 && (
          <div className={styles['staff']}>
            <p className={styles['staffTitle']}>{t('clientPortal.staffAttributionsTitle')}</p>
            <ul className={styles['staffList']}>
              {publication.staffAttributions.map((staff) => (
                <li key={staff.id}>
                  {staff.displayName}
                  {staff.roleLabel !== undefined ? ` — ${staff.roleLabel}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className={styles['items']}>
          {publication.items.map((item) => (
            <li key={item.id} className={styles['item']}>
              <time className={styles['itemTime']} dateTime={item.occurredAt}>
                {formatInstant(item.occurredAt, locale)}
              </time>
              <PublicationItemContent
                publicationId={publication.id}
                kind={item.kind}
                description={item.description}
                mediaId={item.mediaId}
                mediaRole={item.mediaRole}
                caption={item.caption}
                overviewText={item.overviewText}
                snapshotData={item.snapshotData}
                entryText={item.entryText}
                narrativeText={item.narrativeText}
              />
            </li>
          ))}
        </ul>
      </Card>
    </li>
  );
}
