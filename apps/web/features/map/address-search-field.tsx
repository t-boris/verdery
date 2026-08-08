'use client';

import type { AddressCandidate } from '@verdery/api-contracts';
import { useEffect, useState } from 'react';

import { useIsOnline } from '@/core/connectivity/public';
import { useLocalization } from '@/shared/localization/public';
import { Alert, Button, FailureAlert, TextField } from '@/shared/ui/public';

import { useAddressCandidates } from './queries';
import styles from './address-search-field.module.css';

export interface AddressSearchFieldProps {
  /** Called with `[longitude, latitude]` when a candidate is chosen. */
  readonly onPick: (position: readonly [number, number], formattedAddress: string) => void;
  /**
   * What the field starts with — the address this garden was last placed by.
   * The panel keeps it, because retyping an address to adjust a location by
   * one house number is work a person should not have to do twice.
   */
  readonly initialQuery?: string;
}

/**
 * Finding a garden by its address instead of by its coordinates.
 *
 * The result is a suggestion, never a decision: candidates are listed, one is
 * picked, and what the garden stores is the anchor the person accepted. That
 * is also why nothing here is remembered — no provider result reaches this
 * application's database.
 *
 * Worldwide since 2026-08-08, when Nominatim replaced the US Census geocoder
 * — a European address could not be found at all, because the service it
 * replaced is a US federal one. Address data is © OpenStreetMap contributors,
 * and the hint beside this field carries that attribution. The empty state
 * says what happened plainly rather
 * than leaving someone outside the US to conclude their address is wrong.
 *
 * Source: implementation-plan.md work package P12-GEO-01;
 * packages/api-contracts/openapi.yaml, operation `findAddressCandidates`.
 */
export function AddressSearchField({ onPick, initialQuery = '' }: AddressSearchFieldProps) {
  const { t } = useLocalization();
  const isOnline = useIsOnline();
  const [query, setQuery] = useState(initialQuery);
  const search = useAddressCandidates();

  // The saved address arrives with the map query after the first render, and
  // choosing a candidate updates it in the parent. Keep the visible field in
  // step with both instead of freezing the empty first-render value forever.
  useEffect(() => setQuery(initialQuery), [initialQuery]);

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
