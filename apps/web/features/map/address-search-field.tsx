'use client';

import type { AddressCandidate } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, FailureAlert, TextField } from '@/shared/ui/public';

import { useAddressCandidates } from './queries';
import styles from './address-search-field.module.css';

export interface AddressSearchFieldProps {
  /** Saved accepted address, restored when the georeference revision loads. */
  readonly initialAddress?: string;
  /** Called with `[longitude, latitude]` when a candidate is chosen. */
  readonly onPick: (position: readonly [number, number], formattedAddress: string) => void;
}

/**
 * Finding a garden by its address instead of by its coordinates.
 *
 * The result is a suggestion, never a decision: candidates are listed and one
 * is picked. The accepted coordinate and formatted display address persist
 * with the georeference; the query and unaccepted candidates do not.
 *
 * United States addresses only, which is the geocoder's own coverage and the
 * product's first market (ADR-0007). The empty state says that plainly rather
 * than leaving someone outside the US to conclude their address is wrong.
 *
 * Source: implementation-plan.md work package P12-GEO-01;
 * packages/api-contracts/openapi.yaml, operation `findAddressCandidates`.
 */
export function AddressSearchField({ initialAddress, onPick }: AddressSearchFieldProps) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const [query, setQuery] = useState(initialAddress ?? '');
  const search = useAddressCandidates();

  useEffect(() => {
    if (initialAddress !== undefined) {
      setQuery(initialAddress);
    }
  }, [initialAddress]);

  const onSearch = () => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      return;
    }
    search.mutate(trimmed);
  };

  const result = search.data;

  return (
    <div className={styles['search']}>
      <div className={styles['row']}>
        <TextField
          label={t('gardenLocation.addressLabel')}
          value={query}
          autoComplete="street-address"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // The panel around this is not a form, and would not submit
              // anyway; pressing Enter in an address field means "search".
              event.preventDefault();
              onSearch();
            }
          }}
        />
        <Button
          variant="secondary"
          busy={search.isPending}
          disabled={!isOnline || query.trim().length < 3}
          onClick={onSearch}
        >
          {t('gardenLocation.addressSearch')}
        </Button>
      </div>

      {search.isError && <FailureAlert failure={search.error.failure} />}

      {result !== undefined && !result.providerAvailable && (
        <Alert tone="info" title={t('gardenLocation.addressProviderUnavailable')} />
      )}

      {result !== undefined && result.providerAvailable && result.items.length === 0 && (
        <p className={styles['empty']}>{t('gardenLocation.addressNoMatches')}</p>
      )}

      {result !== undefined && result.items.length > 0 && (
        <ul className={styles['candidates']}>
          {result.items.map((candidate) => (
            <li key={`${candidate.formattedAddress}-${String(candidate.position[0])}`}>
              <button
                type="button"
                className={styles['candidate']}
                onClick={() => {
                  setQuery(candidate.formattedAddress);
                  pick(candidate, onPick);
                }}
              >
                <span className={styles['address']}>{candidate.formattedAddress}</span>
                <span className={styles['precision']}>
                  {t(precisionLabelKey(candidate.precision))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function pick(candidate: AddressCandidate, onPick: AddressSearchFieldProps['onPick']): void {
  const [longitude, latitude] = candidate.position;

  // The contract types `Position` as a number array, which cannot say "exactly
  // two". A candidate that somehow carries fewer is not a place.
  if (longitude === undefined || latitude === undefined) {
    return;
  }

  onPick([longitude, latitude], candidate.formattedAddress);
}

/** What the provider's precision means for someone deciding whether to accept a pin. */
function precisionLabelKey(precision: AddressCandidate['precision']) {
  switch (precision) {
    case 'streetAddress':
      return 'gardenLocation.precisionStreetAddress' as const;
    case 'street':
      return 'gardenLocation.precisionStreet' as const;
    default:
      return 'gardenLocation.precisionArea' as const;
  }
}
