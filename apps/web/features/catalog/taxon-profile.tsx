'use client';

import type { ResolvedFact } from '@verdery/api-contracts';
import { useState } from 'react';

import { formatInstant, useLocalization, type MessageKey } from '@/shared/localization/public';
import { Alert, FailureAlert, PhotoLightbox } from '@/shared/ui/public';

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

const FACT_LABELS: Readonly<Record<string, MessageKey>> = {
  hardinesszonemin: 'catalog.factHardinessMinimum',
  hardinesszonemax: 'catalog.factHardinessMaximum',
  sunexposure: 'catalog.factSunExposure',
  waterneeds: 'catalog.factWaterNeeds',
  soiltype: 'catalog.factSoilType',
  soilphmin: 'catalog.factSoilPhMinimum',
  soilphmax: 'catalog.factSoilPhMaximum',
  drainage: 'catalog.factDrainage',
  matureheightcm: 'catalog.factMatureHeight',
  maturespreadcm: 'catalog.factMatureSpread',
  growthhabit: 'catalog.factGrowthHabit',
  lifecycle: 'catalog.factLifeCycle',
  bloomtime: 'catalog.factBloomTime',
  harvesttime: 'catalog.factHarvestTime',
  pruning: 'catalog.factPruning',
  propagation: 'catalog.factPropagation',
  wildlifevalue: 'catalog.factWildlifeValue',
  toxicity: 'catalog.factToxicity',
  edibility: 'catalog.factEdibility',
  interestingfact: 'catalog.factInterestingFact',
};

function normalizedFactKey(key: string): string {
  return key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
}

function readableFactKey(key: string): string {
  const words = key
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll(/[._-]+/g, ' ')
    .trim();
  return words === '' ? key : `${words[0]?.toUpperCase() ?? ''}${words.slice(1)}`;
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
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);

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

  const { taxonomyReference, profile, images } = query.data;
  const citations = [
    ...new Set(
      (profile?.resolvedFacts ?? [])
        .map((fact) => fact.sourceCitation)
        .filter((citation): citation is string => citation !== null && citation.trim() !== ''),
    ),
  ];
  const lightboxPhotos = images.map((image, index) => {
    const alt =
      image.organ === null || image.organ === undefined
        ? t('catalog.imageAlt')
        : t('catalog.imageAltOrgan', { organ: image.organ });
    return {
      id: image.id,
      src: image.sourceUrl,
      alt,
      caption:
        image.attribution === null || image.attribution === undefined
          ? undefined
          : t('catalog.imageCredit', { holder: image.attribution }),
      openLabel: t('catalog.imageOpenFullscreen', { number: index + 1 }),
    };
  });

  return (
    <div className={styles['profile']}>
      <section className={styles['identity']} aria-labelledby="taxon-name">
        <div>
          <p className={styles['eyebrow']}>{t('catalog.taxonomyLabel')}</p>
          <h2 id="taxon-name" className={styles['commonName']}>
            {taxonomyReference.commonName ?? taxonomyReference.scientificName}
          </h2>
          <p className={styles['scientificName']}>{taxonomyReference.scientificName}</p>
        </div>
        <dl className={styles['taxonomyFacts']}>
          {taxonomyReference.family !== null && (
            <div>
              <dt>{t('catalog.familyLabel')}</dt>
              <dd>{taxonomyReference.family}</dd>
            </div>
          )}
          {taxonomyReference.genus !== null && (
            <div>
              <dt>{t('catalog.genusLabel')}</dt>
              <dd>{taxonomyReference.genus}</dd>
            </div>
          )}
          {taxonomyReference.varietyName !== null && (
            <div>
              <dt>{t('catalog.varietyLabel')}</dt>
              <dd>{taxonomyReference.varietyName}</dd>
            </div>
          )}
          <div>
            <dt>{t('catalog.taxonomySourceLabel')}</dt>
            <dd>{taxonomyReference.source.replaceAll('_', ' ')}</dd>
          </div>
        </dl>
      </section>

      {profile !== null && (
        <p className={styles['assembled']}>
          {t('catalog.profileAssembled', { date: formatInstant(profile.createdAt, locale) })}
        </p>
      )}

      {images.length > 0 && (
        <ul className={styles['images']}>
          {images.map((image, index) => (
            <li key={image.id} className={styles['image']}>
              <button
                type="button"
                className={styles['imageButton']}
                onClick={() => setActiveImageIndex(index)}
                aria-label={lightboxPhotos[index]?.openLabel}
              >
                {/* Provider images are fetched immediately so the gallery and
                    lightbox reuse the same browser-cached bytes. */}
                <img
                  src={image.sourceUrl}
                  alt={lightboxPhotos[index]?.alt}
                  loading="eager"
                  decoding="async"
                />
              </button>
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

      <PhotoLightbox
        photos={lightboxPhotos}
        activeIndex={activeImageIndex}
        dialogLabel={t('catalog.profileTitle')}
        closeLabel={t('catalog.imageCloseFullscreen')}
        previousLabel={t('catalog.imagePrevious')}
        nextLabel={t('catalog.imageNext')}
        onSelect={setActiveImageIndex}
        onClose={() => setActiveImageIndex(null)}
      />

      {profile?.isPartial && (
        <Alert tone="info" title={t('catalog.profilePartialTitle')}>
          {t('catalog.profilePartial')}
        </Alert>
      )}

      {profile === null || profile.resolvedFacts.length === 0 ? (
        <Alert tone="info" title={t('catalog.profileNoFactsTitle')}>
          {t('catalog.profileNoFacts')}
        </Alert>
      ) : (
        <dl className={styles['facts']}>
          {profile.resolvedFacts.map((fact) => {
            const labelKey = FACT_LABELS[normalizedFactKey(fact.factKey)];
            return (
              <div className={styles['fact']} key={fact.factKey}>
                <dt className={styles['factKey']}>
                  {labelKey === undefined ? readableFactKey(fact.factKey) : t(labelKey)}
                </dt>
                <dd className={styles['factBody']}>
                  <span className={styles['factValue']}>
                    {factValue(fact)}
                    {fact.unit !== null && ` ${fact.unit}`}
                  </span>
                  <span className={styles['factMeta']}>
                    <span className={styles['evidenceStatus']}>
                      {t(
                        fact.evidenceStatus === 'horticulturally_reviewed'
                          ? 'catalog.factReviewed'
                          : 'catalog.factSourceBacked',
                      )}
                    </span>
                    <span>{t('catalog.factProvider', { provider: fact.providerKey })}</span>
                    {fact.geographicScope !== null && (
                      <span>{t('catalog.factScope', { scope: fact.geographicScope })}</span>
                    )}
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {/* Citations belong to the SOURCES, not to each fact, so they are
          listed once. Rendering `sourceCitation` per row printed the same
          sentence under every fact of the same provider — and with a
          provider that contributes many facts, the citation was most of the
          page. Deduplicated by text rather than by provider key: two
          providers citing the same work should still say it once. */}
      {citations.length > 0 && (
        <section className={styles['citations']} aria-labelledby="taxon-citations">
          <h3 id="taxon-citations" className={styles['citationsTitle']}>
            {t('catalog.sourcesTitle')}
          </h3>
          <ul className={styles['citationList']}>
            {citations.map((citation) => (
              <li key={citation}>{citation}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
