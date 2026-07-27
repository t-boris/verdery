'use client';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator } from '@/shared/ui/public';

import { ClientTimelineEntry } from './client-timeline-entry';
import styles from './client-timeline.module.css';
import { useClientTimeline } from './queries';

/**
 * The factual Garden Timeline (`getClientTimeline`) — every visible item of
 * every kind, across every publication version, flattened into ONE
 * chronological sequence ordered oldest-first.
 *
 * Deliberately rendered as a flat list of individually-timestamped rows
 * (`ClientTimelineEntry`), never as version-grouped cards: `ClientPublications`
 * groups the SAME underlying facts by publication version (title, summary,
 * a bounded item list per publish event, newest first); this view has no
 * version grouping or title/summary at all, matching the backend's own
 * "genuinely different shapes" design (`getClientTimeline`'s own
 * description) rather than rendering both identically. A reader who wants
 * "what did the publisher tell me, and when" uses Updates; a reader who
 * wants "what actually happened to my garden, and when" uses this.
 *
 * Source: implementation-plan.md work package P9C-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `getClientTimeline`;
 * architecture/collaboration-and-client-sharing.md, section
 * "12. Garden Timeline and Time Machine", §12.1.
 */
export function ClientTimeline({ clientGardenId }: { readonly clientGardenId: string }) {
  const { t } = useLocalization();
  const query = useClientTimeline(clientGardenId);

  if (query.isPending) {
    return <p role="status">{t('clientPortal.timelineLoading')}</p>;
  }

  if (query.isLoadingError) {
    return (
      <div className={styles['errorState']}>
        <FailureAlert failure={query.error.failure} />
        <Button variant="secondary" onClick={() => void query.refetch()}>
          {t('clientPortal.timelineRetry')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <StaleIndicator failure={query.isError ? query.error.failure : null} />
      {query.isError && !isConnectivityFailure(query.error.failure) && (
        <FailureAlert failure={query.error.failure} />
      )}
      {query.data.items.length === 0 ? (
        <p className={styles['empty']}>{t('clientPortal.timelineEmpty')}</p>
      ) : (
        <ol className={styles['list']}>
          {query.data.items.map((entry, index) => (
            // `ClientTimelineEntry` carries no id of its own (unlike a
            // publication item) — the contract flattens facts across
            // versions with no per-entry identifier, so this already-
            // ordered, never-reordered sequence's own position is the only
            // stable key available.
            <ClientTimelineEntry key={`${entry.publicationId}-${String(index)}`} entry={entry} />
          ))}
        </ol>
      )}
    </>
  );
}
