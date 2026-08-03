'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { FailureAlert, TextField } from '@/shared/ui/public';

import { TAXON_SEARCH_LIMIT, useTaxonSearch } from './queries';
import styles from './taxon-search.module.css';

export interface TaxonSearchProps {
  readonly gardenId: string;
}

/**
 * Browsing the plant catalog: find a taxon by name, open what is known about
 * it.
 *
 * This is `searchTaxonomyReferences`, not a catalog-specific search endpoint —
 * there is none, and inventing a client-side index over a paged name search
 * would be an illusion of browsing rather than browsing. The consequence is
 * visible and stated: results are a bounded page of name matches, with no
 * facets, no filters, and no imagery, because the catalog exposes no media
 * endpoint (ADR-0016 §3 lists `plant_media_asset` as a table with no read
 * surface yet).
 *
 * An empty query lists what this garden can already resolve against, which is
 * what makes it a browse rather than a lookup: a reader who does not know a
 * name still sees something.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `searchTaxonomyReferences`.
 */
export function TaxonSearch({ gardenId }: TaxonSearchProps) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  const search = useTaxonSearch(gardenId, query);

  const items = search.data?.items ?? [];

  return (
    <div className={styles['panel']}>
      <TextField
        label={t('catalog.searchLabel')}
        value={query}
        placeholder={t('catalog.searchPlaceholder')}
        onChange={(event) => setQuery(event.target.value)}
      />

      {search.isError && <FailureAlert failure={search.error.failure} />}

      {search.data !== undefined &&
        (items.length === 0 ? (
          <p className={styles['empty']}>{t('catalog.searchEmpty')}</p>
        ) : (
          <>
            <ul className={styles['results']}>
              {items.map((taxon) => (
                <li className={styles['result']} key={taxon.id}>
                  <Link
                    className={styles['link']}
                    href={`/application/gardens/${gardenId}/catalog/${taxon.id}`}
                  >
                    <span className={styles['scientificName']}>{taxon.scientificName}</span>
                    <span className={styles['meta']}>
                      {[taxon.commonName, taxon.varietyName]
                        .filter((part) => part !== null)
                        .join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {/*
              The page bound is a real limit, not pagination — this operation
              takes no cursor. Saying so is the only honest option: silently
              showing the first 25 of an unknown number would read as "that is
              all there is".
            */}
            {items.length === TAXON_SEARCH_LIMIT && (
              <p className={styles['bounded']}>
                {t('catalog.searchBounded', { limit: TAXON_SEARCH_LIMIT })}
              </p>
            )}
          </>
        ))}
    </div>
  );
}
