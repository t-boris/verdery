'use client';

import type { Plant } from '@verdery/api-contracts';
import Link from 'next/link';
import { useState } from 'react';

import { isConnectivityFailure } from '@/core/api/public';
import { useLocalization, type MessageKey } from '@/shared/localization/public';
import {
  RefreshIcon,
  ChevronDownIcon,
  Button,
  FailureAlert,
  LeafIcon,
  StaleIndicator,
  TextField,
  classNames,
} from '@/shared/ui/public';

import { PLANT_STATUSES, groupingKindLabel, lifecycleStageLabel, statusLabel } from './labels';
import { usePlantPhotoAccess } from './plant-media-queries';
import styles from './plant-list.module.css';
import { useSearchPlants } from './queries';

export interface PlantListProps {
  readonly gardenId: string;
}

const PAGE_LIMIT = 20;

/**
 * Every status except `removed` — there is no filter UI yet (a deliberate,
 * documented scope call, see this component's own doc comment), so the one
 * thing this list must not do by default is keep showing a plant the reader
 * just deleted (`SetPlantStatus('removed')`, `PlantDeleteSection`) as if
 * nothing happened.
 */
const VISIBLE_STATUSES = PLANT_STATUSES.filter((status) => status !== 'removed');

/**
 * A garden's plant inventory, searchable by `displayName` via `SearchPlants`
 * (`GET /gardens/{gardenId}/plants`, P4-SEARCH-01). Closes a real,
 * documented gap: before this endpoint existed, this feature had no way to
 * list a garden's plants at all — only `OpenPlantByIdForm`'s navigate-by-
 * known-id and `AddPlantForm`'s create-then-navigate. See
 * `docs/development/deferred-capabilities.md` for the now-closed history.
 *
 * Most of the structured filters `SearchPlants` also accepts
 * (`lifecycleStage`/`groupingKind`, and `status` beyond the fixed default
 * below) are still deliberately left out of this pass — only the free-text
 * `query` (matched trigram-fuzzy against `displayName`) plus `identified`
 * (P11-SEARCH-01 — added as its own follow-up, since "which plants still
 * need identifying" is a real, common question this list had no way to
 * answer) are user-facing, per this component's own explicit scope: a real,
 * working list takes priority over exhaustive filter UI. `status` itself is
 * always sent, fixed to `VISIBLE_STATUSES` (every status except `removed`),
 * so a plant the reader just deleted does not keep appearing here as if
 * nothing happened — see that constant's own doc comment.
 *
 * Pagination is a plain "Load more" button over the contract's own
 * `nextCursor` convention (`ListGardens`/`SearchPlants` share it). Earlier
 * pages are frozen into `priorItems` the moment "Load more" is clicked, so
 * only the most recently requested page stays a live, reactive
 * `useSearchPlants` result — that keeps `StaleIndicator` meaningful for the
 * page currently loading without having to reconcile duplicate items across
 * every page fetched so far. If that most recent page's fetch fails, its
 * error is shown as a small inline notice with its own retry, and the
 * already-loaded earlier pages stay visible rather than being replaced by a
 * full failure screen — the full failure screen (`isLoadingError`-shaped) is
 * reserved for when there is nothing loaded at all yet.
 *
 * Source: implementation-plan.md work package P4-SEARCH-01;
 * packages/api-contracts/openapi.yaml, operation `searchPlants`.
 */
type IdentifiedFilter = 'all' | 'identified' | 'unidentified';

const IDENTIFIED_FILTERS: readonly {
  readonly value: IdentifiedFilter;
  readonly labelKey: MessageKey;
}[] = [
  { value: 'all', labelKey: 'plants.identifiedFilterAll' },
  { value: 'identified', labelKey: 'plants.identifiedFilterIdentified' },
  { value: 'unidentified', labelKey: 'plants.identifiedFilterUnidentified' },
];

function toIdentifiedParam(filter: IdentifiedFilter): boolean | null {
  switch (filter) {
    case 'all':
      return null;
    case 'identified':
      return true;
    case 'unidentified':
      return false;
  }
}

export function PlantList({ gardenId }: PlantListProps) {
  const { t } = useLocalization();
  const [searchText, setSearchText] = useState('');
  const [identifiedFilter, setIdentifiedFilter] = useState<IdentifiedFilter>('all');
  const [cursor, setCursor] = useState<string | null>(null);
  const [priorItems, setPriorItems] = useState<readonly Plant[]>([]);

  const query = useSearchPlants(gardenId, {
    query: searchText.trim() === '' ? null : searchText.trim(),
    status: VISIBLE_STATUSES,
    identified: toIdentifiedParam(identifiedFilter),
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

  const onIdentifiedFilterChange = (value: IdentifiedFilter) => {
    setIdentifiedFilter(value);
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
  // A failed fetch with nothing already loaded is a full failure state —
  // there is nothing to preserve. A failed fetch for a *later* page, with
  // earlier pages already visible, must not discard them (same "existing
  // data stays visible" rule the other list views apply to background
  // refetches — see `garden-list.tsx`'s doc comment).
  const showFullFailure = query.isLoadingError && priorItems.length === 0;
  const items = [...priorItems, ...(query.data?.items ?? [])];

  return (
    <div className={styles['panel']}>
      <div className={styles['filterBar']}>
        <div className={styles['filterSearch']}>
          <TextField
            label={t('plants.searchLabel')}
            value={searchText}
            placeholder={t('plants.searchLabel')}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        {/*
          A segmented control rather than a `Select`: three mutually exclusive
          options read faster as one strip than as a dropdown, and the strip is
          what gives the bar its full-height Kern rhythm. `aria-pressed` carries
          the active option, so the fill is never the only signal.
        */}
        <div
          className={styles['filterSegments']}
          role="group"
          aria-label={t('plants.identifiedFilterLabel')}
        >
          {IDENTIFIED_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={classNames(
                styles['segment'],
                identifiedFilter === filter.value && styles['segmentActive'],
              )}
              aria-pressed={identifiedFilter === filter.value}
              onClick={() => onIdentifiedFilterChange(filter.value)}
            >
              {t(filter.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {isFirstLoad && <p role="status">{t('plants.listLoading')}</p>}

      {showFullFailure && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button
            variant="secondary"
            onClick={() => void query.refetch()}
            iconOnly
            aria-label={t('plants.listRetry')}
            title={t('plants.listRetry')}
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
            <p className={styles['empty']}>{t('plants.listEmpty')}</p>
          )}

          {items.length > 0 && (
            <ul className={styles['list']}>
              {items.map((plant) => (
                <PlantListItem key={plant.id} gardenId={gardenId} plant={plant} />
              ))}
            </ul>
          )}

          {isLoadingMore && <p role="status">{t('plants.listLoadingMore')}</p>}

          <div className={styles['loadMoreRow']}>
            {!isLoadingMore && query.data?.nextCursor !== undefined && (
              <Button
                variant="secondary"
                onClick={onLoadMore}
                iconOnly
                aria-label={t('plants.listLoadMore')}
                title={t('plants.listLoadMore')}
              >
                <ChevronDownIcon />
              </Button>
            )}
            {!isLoadingMore && query.isError && items.length > 0 && (
              <Button variant="secondary" onClick={() => void query.refetch()}>
                {t('plants.listRetry')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** `Plant.coverMediaId`'s own resolved photo — see that field's doc comment in the contract: `searchPlants` is the only operation that ever populates it. */
function PlantCoverPhoto({
  gardenId,
  mediaId,
}: {
  readonly gardenId: string;
  readonly mediaId: string;
}) {
  const query = usePlantPhotoAccess(gardenId, mediaId);

  // `data` is absent both while the photo is still being validated and when
  // the read failed; the fallback covers each, and the status poll behind the
  // hook swaps in the cover once it is ready.
  if (query.data === undefined) {
    return <PlantCoverFallback />;
  }

  // A plain `<img>`, not `next/image` — see `plant-photo-gallery.tsx`'s own
  // doc comment: the source is a short-lived signed Cloud Storage URL,
  // re-issued per fetch, which Next's optimizer can neither cache nor be
  // configured for by `remotePatterns`. The direction asks for `next/image`
  // with `sizes="16vw"` to protect the LCP budget at 18+ tiles; the budget is
  // met instead by `.coverBox`'s fixed 118px box (so no tile reflows as URLs
  // resolve) plus lazy, off-thread decoding here.
  return (
    <img className={styles['cover']} src={query.data.url} alt="" loading="lazy" decoding="async" />
  );
}

/** Shown in place of a cover photo: no `coverMediaId` yet, or its signed URL failed to resolve (including the documented dev-environment media-processing gap). */
function PlantCoverFallback() {
  return (
    <span className={styles['coverFallback']}>
      <LeafIcon size={24} />
    </span>
  );
}

function PlantListItem({ gardenId, plant }: { readonly gardenId: string; readonly plant: Plant }) {
  const { t } = useLocalization();

  return (
    <li className={styles['item']}>
      <Link className={styles['link']} href={`/application/gardens/${gardenId}/plants/${plant.id}`}>
        <span className={styles['coverBox']}>
          {plant.coverMediaId !== null ? (
            <PlantCoverPhoto gardenId={gardenId} mediaId={plant.coverMediaId} />
          ) : (
            <PlantCoverFallback />
          )}
          {/* An ink chip over the photo's corner replaces the row's `StatusPill`: at card width the pill's own padding cost more room than the word it carried. */}
          <span className={styles['statusChip']}>{t(statusLabel(plant.status))}</span>
        </span>
        <span className={styles['itemBody']}>
          <span className={styles['name']}>{plant.displayName}</span>
          <span className={styles['meta']}>
            <span>{t(lifecycleStageLabel(plant.lifecycleStage))}</span>
            <span>{t(groupingKindLabel(plant.groupingKind))}</span>
            {plant.quantity !== null && (
              <span>{t('plants.quantityDisplay', { quantity: plant.quantity })}</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
