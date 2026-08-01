'use client';

import type {
  PlantCandidate,
  PlantCandidatePriority,
  PlantCandidateStatus,
} from '@verdery/api-contracts';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronDownIcon, RefreshIcon } from '@/shared/ui/public';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, StaleIndicator, StatusPill, TextField } from '@/shared/ui/public';

import {
  CANDIDATE_PRIORITIES,
  CANDIDATE_STATUSES,
  candidateGroupingKindLabel,
  candidatePriorityLabel,
  candidateStatusLabel,
  candidateStatusTone,
} from './labels';
import styles from './candidate-list.module.css';
import { useListCandidates } from './queries';

export interface CandidateListProps {
  readonly gardenId: string;
}

const PAGE_LIMIT = 20;

/** The statuses a candidate is still being worked on under — the default view. `archived` and `rejected` are reachable through the filter, never shown unasked. */
const WORKING_STATUSES: readonly PlantCandidateStatus[] = CANDIDATE_STATUSES.filter(
  (status) => status !== 'archived' && status !== 'rejected',
);

/**
 * A garden's plant candidates — plants under consideration, not yet
 * planted — searchable by `displayName` and filterable by status and
 * priority via `ListCandidates`
 * (`GET /gardens/{gardenId}/plant-candidates`, P11-SEARCH-01/P11-API-01).
 *
 * An empty PRIORITY selection means "every value", mirroring
 * `features/tasks/task-list.tsx`'s own filter-fieldset convention.
 *
 * STATUS does not work that way: it starts at `WORKING_STATUSES`, everything
 * except `archived` and `rejected`, so disposing of a candidate removes it
 * from the list the way a user who just archived it expects. This list used to
 * default to every status on the reasoning that browsing disposed candidates
 * is useful — it is, but not as the default view: an archived candidate that
 * stays put reads as an archive that did not work, which is exactly how it was
 * reported. Both statuses remain one checkbox away, and `plant-list.tsx` hides
 * its own `removed` plants for the same reason.
 *
 * Pagination mirrors `plant-list.tsx`'s own "Load more" / frozen-prior-pages
 * approach — see that component's doc comment for the full reasoning.
 *
 * Source: implementation-plan.md work package P11-WEB-01;
 * packages/api-contracts/openapi.yaml, operation `listCandidates`.
 */
export function CandidateList({ gardenId }: CandidateListProps) {
  const { t } = useLocalization();
  const [searchText, setSearchText] = useState('');
  const [selectedStatuses, setSelectedStatuses] =
    useState<readonly PlantCandidateStatus[]>(WORKING_STATUSES);
  const [selectedPriorities, setSelectedPriorities] = useState<readonly PlantCandidatePriority[]>(
    [],
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [priorItems, setPriorItems] = useState<readonly PlantCandidate[]>([]);

  const query = useListCandidates(gardenId, {
    query: searchText.trim() === '' ? null : searchText.trim(),
    status: selectedStatuses.length === 0 ? null : selectedStatuses,
    priority: selectedPriorities.length === 0 ? null : selectedPriorities,
    cursor,
    limit: PAGE_LIMIT,
  });

  const resetPagination = () => {
    setCursor(null);
    setPriorItems([]);
  };

  const onSearchChange = (value: string) => {
    setSearchText(value);
    resetPagination();
  };

  const toggleStatus = (status: PlantCandidateStatus) => {
    setSelectedStatuses((current) =>
      current.includes(status) ? current.filter((value) => value !== status) : [...current, status],
    );
    resetPagination();
  };

  const togglePriority = (priority: PlantCandidatePriority) => {
    setSelectedPriorities((current) =>
      current.includes(priority)
        ? current.filter((value) => value !== priority)
        : [...current, priority],
    );
    resetPagination();
  };

  const onLoadMore = () => {
    const currentPage = query.data;
    if (currentPage === undefined || currentPage.nextCursor === undefined) {
      return;
    }
    setPriorItems((current) => [...current, ...currentPage.items]);
    setCursor(currentPage.nextCursor);
  };

  const isFirstLoad = query.isPending && priorItems.length === 0;
  const isLoadingMore = query.isPending && priorItems.length > 0;
  const showFullFailure = query.isLoadingError && priorItems.length === 0;
  const items = [...priorItems, ...(query.data?.items ?? [])];

  return (
    <div className={styles['panel']}>
      <TextField
        label={t('candidates.searchLabel')}
        value={searchText}
        onChange={(event) => onSearchChange(event.target.value)}
      />

      <div className={styles['filters']}>
        <fieldset className={styles['filterGroup']}>
          <legend>{t('candidates.filterLegend')}</legend>
          {CANDIDATE_STATUSES.map((status) => (
            <label key={status} className={styles['filterOption']}>
              <input
                type="checkbox"
                checked={selectedStatuses.includes(status)}
                onChange={() => toggleStatus(status)}
              />
              {t(candidateStatusLabel(status))}
            </label>
          ))}
        </fieldset>

        <fieldset className={styles['filterGroup']}>
          <legend>{t('candidates.filterPriorityLegend')}</legend>
          {CANDIDATE_PRIORITIES.map((priority) => (
            <label key={priority} className={styles['filterOption']}>
              <input
                type="checkbox"
                checked={selectedPriorities.includes(priority)}
                onChange={() => togglePriority(priority)}
              />
              {t(candidatePriorityLabel(priority))}
            </label>
          ))}
        </fieldset>
      </div>

      {isFirstLoad && <p role="status">{t('candidates.listLoading')}</p>}

      {showFullFailure && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button
            variant="secondary"
            onClick={() => void query.refetch()}
            iconOnly
            aria-label={t('candidates.listRetry')}
            title={t('candidates.listRetry')}
          >
            <RefreshIcon />
          </Button>
        </div>
      )}

      {!showFullFailure && (
        <>
          <StaleIndicator failure={query.isError ? query.error.failure : null} />
          {query.isError && !isConnectivityFailure(query.error.failure) && (
            <FailureAlert failure={query.error.failure} />
          )}

          {!isFirstLoad && items.length === 0 && (
            <p className={styles['empty']}>{t('candidates.listEmpty')}</p>
          )}

          {items.length > 0 && (
            <ul className={styles['list']}>
              {items.map((candidate) => (
                <CandidateListItem key={candidate.id} gardenId={gardenId} candidate={candidate} />
              ))}
            </ul>
          )}

          {isLoadingMore && <p role="status">{t('candidates.listLoadingMore')}</p>}

          <div className={styles['loadMoreRow']}>
            {!isLoadingMore && query.data?.nextCursor !== undefined && (
              <Button
                variant="secondary"
                onClick={onLoadMore}
                iconOnly
                aria-label={t('candidates.listLoadMore')}
                title={t('candidates.listLoadMore')}
              >
                <ChevronDownIcon />
              </Button>
            )}
            {!isLoadingMore && query.isError && items.length > 0 && (
              <Button variant="secondary" onClick={() => void query.refetch()}>
                {t('candidates.listRetry')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CandidateListItem({
  gardenId,
  candidate,
}: {
  readonly gardenId: string;
  readonly candidate: PlantCandidate;
}) {
  const { t } = useLocalization();

  return (
    <li className={styles['item']}>
      <Link
        className={styles['link']}
        href={`/application/gardens/${gardenId}/candidates/${candidate.id}`}
      >
        <span className={styles['name']}>{candidate.displayName}</span>
        <span className={styles['meta']}>
          <StatusPill
            tone={candidateStatusTone(candidate.status)}
            label={t(candidateStatusLabel(candidate.status))}
          />
          <span>{t(candidateGroupingKindLabel(candidate.groupingKind))}</span>
          {candidate.priority !== null && (
            <span>
              {t('candidates.priorityDisplay', {
                priority: t(candidatePriorityLabel(candidate.priority)),
              })}
            </span>
          )}
          {candidate.quantity !== null && (
            <span>{t('candidates.quantityDisplay', { quantity: candidate.quantity })}</span>
          )}
        </span>
      </Link>
    </li>
  );
}
