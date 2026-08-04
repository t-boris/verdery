'use client';

import type { ResolvedFact } from '@verdery/api-contracts';

import { formatInstant, useLocalization } from '@/shared/localization/public';
import { Alert, FailureAlert } from '@/shared/ui/public';

import { useTaxonProfile } from './queries';
import styles from './taxon-profile.module.css';

export interface TaxonProfileProps {
  readonly taxonomyReferenceId: string;
}

/** A fact's value as text. Values are provider-shaped and untyped in the contract, so anything that is not already a string is shown as its JSON rather than guessed at. */
function factValue(fact: ResolvedFact): string {
  if (typeof fact.value === 'string') {
    return fact.value;
  }
  return JSON.stringify(fact.value);
}

/**
 * What is known about one taxon, and who said it.
 *
 * Every row carries its provider and citation because these facts are
 * assembled from external ledgers under source priority — a reader deciding
 * whether to plant something needs to know whether a hardiness range came from
 * a federal dataset or an occurrence record. Only `horticulturally_reviewed`
 * assertions ever reach this projection, which is exactly why the unreviewed
 * ones are absent rather than shown with a caveat.
 *
 * `isPartial` is surfaced as a notice rather than a badge: it means at least
 * one fact key seen among candidate assertions never resolved, so the profile
 * is incomplete in a way the reader must not mistake for "nothing more is
 * true".
 *
 * A `404` is the honest answer for a taxon nobody has assembled a profile for.
 * It is shown as that sentence, not as a failure alert — the request was fine,
 * the knowledge simply does not exist yet.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `getTaxonProfile`.
 */
export function TaxonProfile({ taxonomyReferenceId }: TaxonProfileProps) {
  const { t, locale } = useLocalization();
  const query = useTaxonProfile(taxonomyReferenceId);

  if (query.isPending) {
    return <p className={styles['status']}>{t('catalog.profileLoading')}</p>;
  }

  if (query.isError) {
    return query.error.failure.status === 404 ? (
      <p className={styles['status']}>{t('catalog.profileMissing')}</p>
    ) : (
      <FailureAlert failure={query.error.failure} />
    );
  }

  const { profile, images } = query.data;

  return (
    <div className={styles['profile']}>
      <p className={styles['assembled']}>
        {t('catalog.profileAssembled', { date: formatInstant(profile.createdAt, locale) })}
      </p>

      {images.length > 0 && (
        <ul className={styles['images']}>
          {images.map((image) => (
            <li key={image.id} className={styles['image']}>
              {/* Not next/image: these are third-party URLs on hosts this
                  application does not control or configure. */}
              <img
                src={image.sourceUrl}
                alt={
                  image.organ === null || image.organ === undefined
                    ? t('catalog.imageAlt')
                    : t('catalog.imageAltOrgan', { organ: image.organ })
                }
                loading="lazy"
              />
              {/* Rendered whenever the server sent one: for CC-BY it is the
                  condition the licence was granted under, not a nicety. */}
              {image.attribution !== null && image.attribution !== undefined && (
                <p className={styles['credit']}>
                  {t('catalog.imageCredit', { holder: image.attribution })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {profile.isPartial && (
        <Alert tone="info" title={t('catalog.profilePartialTitle')}>
          {t('catalog.profilePartial')}
        </Alert>
      )}

      {profile.resolvedFacts.length === 0 ? (
        <p className={styles['status']}>{t('catalog.profileNoFacts')}</p>
      ) : (
        <dl className={styles['facts']}>
          {profile.resolvedFacts.map((fact) => (
            <div className={styles['fact']} key={fact.factKey}>
              {/* The fact key is shown as the provider ledger stores it: this client has no translation table for a vocabulary the sources own, and inventing readable labels would misstate what was asserted. */}
              <dt className={styles['factKey']}>{fact.factKey}</dt>
              <dd className={styles['factBody']}>
                <span className={styles['factValue']}>
                  {factValue(fact)}
                  {fact.unit !== null && ` ${fact.unit}`}
                </span>
                <span className={styles['factMeta']}>
                  <span>{t('catalog.factProvider', { provider: fact.providerKey })}</span>
                  {fact.geographicScope !== null && (
                    <span>{t('catalog.factScope', { scope: fact.geographicScope })}</span>
                  )}
                  {fact.sourceCitation !== null && <span>{fact.sourceCitation}</span>}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
