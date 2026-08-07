'use client';

import type { GardenSeasonalFactAwaitingAcceptance } from '@verdery/api-contracts';
import Link from 'next/link';

import { useLocalization } from '@/shared/localization/public';
import type { Locale, Translate } from '@/shared/localization/public';
import { Alert, Button, FailureAlert, StatusPill } from '@/shared/ui/public';

import { timingRows } from './labels';
import { useAcceptSeasonalFact, useSeasonalAcceptanceQueue } from './queries';
import styles from './seasonal-acceptance-panel.module.css';

export interface SeasonalAcceptancePanelProps {
  readonly gardenId: string;
}

function TaxonEntry({
  item,
  locale,
  t,
  onAccept,
  accepting,
}: {
  readonly item: GardenSeasonalFactAwaitingAcceptance;
  readonly locale: Locale;
  readonly t: Translate;
  readonly onAccept: (factId: string) => void;
  readonly accepting: boolean;
}) {
  const rows = timingRows(item.timing, locale);

  return (
    <li className={styles['entry']}>
      <div className={styles['entryHeader']}>
        <h3 className={styles['taxonName']}>
          {item.commonName ?? item.scientificName}
          {item.commonName !== null && (
            <span className={styles['scientificName']}> {item.scientificName}</span>
          )}
        </h3>
        {/* Disclosure, not a warning: content a horticulturist has not
            signed off is still a legitimate thing to accept, and hiding
            which is which would make the decision less informed, not
            safer. */}
        {item.reviewStatus === 'awaiting_horticultural_review' && (
          <StatusPill tone="neutral" label={t('seasonalAcceptance.awaitingReview')} />
        )}
      </div>

      {rows.length === 0 ? (
        <p className={styles['note']}>{t('seasonalAcceptance.noWindowsConfigured')}</p>
      ) : (
        <ul className={styles['windowList']}>
          {rows.map((row) => (
            <li className={styles['windowRow']} key={row.labelKey}>
              <span className={styles['windowLabel']}>{t(row.labelKey)}</span>
              <span>{t(row.rangeKey, row.rangeArgs)}</span>
            </li>
          ))}
        </ul>
      )}

      {item.sourceCitation !== undefined && (
        <p className={styles['citation']}>
          {t('seasonalAcceptance.source', { source: item.sourceCitation })}
        </p>
      )}

      <div className={styles['entryActions']}>
        <Button
          variant="secondary"
          disabled={accepting}
          onClick={() => {
            onAccept(item.id);
          }}
        >
          {t('seasonalAcceptance.accept')}
        </Button>
      </div>
    </li>
  );
}

/**
 * The seasonal-timing decisions this garden has not made yet.
 *
 * WHY THIS SURFACE EXISTS. Three of the seven automatic checks —
 * sowing windows, succession replanting and crop rotation — read only
 * timing the garden itself has accepted, and treat everything else as
 * absent. Without somewhere to accept, those three are silent in every
 * garden forever, and the care-rules panel beside this one says so while
 * offering no way to act. This is that way.
 *
 * PER TAXON, WITH THE MONTHS SHOWN, AND NO "ACCEPT ALL". The gate exists
 * so that a person saw what they signed; a single button over a list of
 * identifiers would satisfy the database and defeat the control.
 *
 * ONLY ACCEPT. There is no reject: timing this garden has not accepted is
 * already unreadable by the rules, so declining is simply leaving it here.
 *
 * It sits beside the care-rules disclosure because that is where the
 * blocker is read.
 */
export function SeasonalAcceptancePanel({ gardenId }: SeasonalAcceptancePanelProps) {
  const { t, locale } = useLocalization();
  const query = useSeasonalAcceptanceQueue(gardenId);
  const accept = useAcceptSeasonalFact(gardenId);

  // A viewer has no business here at all: the queue is refused to anyone
  // without `editGardenContent`, so `403` is the NORMAL state for them, not
  // something to alarm them about. Rendering nothing is the honest answer —
  // a viewer cannot act on this and never will be able to.
  if (query.isLoadingError && query.error.failure.status === 403) {
    return null;
  }

  return (
    <section className={styles['section']} aria-labelledby="seasonal-acceptance-title">
      <h2 className={styles['title']} id="seasonal-acceptance-title">
        {t('seasonalAcceptance.title')}
      </h2>
      <p className={styles['description']}>{t('seasonalAcceptance.description')}</p>

      {query.isPending && <p role="status">{t('seasonalAcceptance.loading')}</p>}

      {query.isLoadingError && (
        <div className={styles['errorState']}>
          <FailureAlert failure={query.error.failure} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('seasonalAcceptance.retry')}
          </Button>
        </div>
      )}

      {accept.isError && <FailureAlert failure={accept.error.failure} />}

      {/* The two outcomes that are not "accepted" are legitimate states of
          the request, not failures, so they are reported in place rather
          than raised as errors. */}
      {accept.data?.outcome === 'hemisphereUnknown' && (
        <Alert tone="info" title={t('seasonalAcceptance.hemisphereUnknownTitle')}>
          <p>{t('seasonalAcceptance.hemisphereUnknownDescription')}</p>
        </Alert>
      )}
      {accept.data?.outcome === 'notAcceptableHere' && (
        <Alert tone="info" title={t('seasonalAcceptance.notAcceptableTitle')}>
          <p>{t('seasonalAcceptance.notAcceptableDescription')}</p>
        </Alert>
      )}

      {query.data !== undefined && !query.data.hemisphereKnown && (
        <Alert tone="info" title={t('seasonalAcceptance.hemisphereUnknownTitle')}>
          <p>{t('seasonalAcceptance.hemisphereUnknownDescription')}</p>
          <p>
            <Link href={`/application/gardens/${gardenId}`}>
              {t('seasonalAcceptance.setLocation')}
            </Link>
          </p>
        </Alert>
      )}

      {query.data?.hemisphereKnown === true && query.data.items.length === 0 && (
        <p className={styles['note']}>{t('seasonalAcceptance.empty')}</p>
      )}

      {query.data !== undefined && query.data.items.length > 0 && (
        <ul className={styles['list']}>
          {query.data.items.map((item) => (
            <TaxonEntry
              key={item.id}
              item={item}
              locale={locale}
              t={t}
              accepting={accept.isPending}
              onAccept={(factId) => {
                accept.mutate(factId);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
