/**
 * A single name form for a stable application taxon — synonyms, localized
 * common names, and cultivar names `taxonomy_reference`'s one `common_name`
 * column cannot represent. See migrations/1787700000000_plant-taxon-
 * knowledge-profile.sql's own header.
 *
 * No update function and no `CreateTaxonomyName` command in this pass, the
 * same posture `taxonomy-seasonal-fact.ts` documents for its own table:
 * every row is seed/fixture content today; the validator exists for that
 * authoring path and for a later command to reuse, not because one calls it
 * yet.
 *
 * Source: migrations/1787700000000_plant-taxon-knowledge-profile.sql,
 * `plants_inventory.taxonomy_name`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type TaxonomyNameKind = 'accepted_scientific' | 'synonym_scientific' | 'common' | 'cultivar';
export type TaxonomyNameSource = 'system_catalog' | 'user_defined' | 'provider_sourced';

const NAME_KINDS: readonly TaxonomyNameKind[] = [
  'accepted_scientific',
  'synonym_scientific',
  'common',
  'cultivar',
];
const NAME_SOURCES: readonly TaxonomyNameSource[] = [
  'system_catalog',
  'user_defined',
  'provider_sourced',
];

export interface TaxonomyName {
  readonly id: Uuid;
  readonly taxonomyReferenceId: Uuid;
  readonly nameKind: TaxonomyNameKind;
  /** Required exactly for `'common'` — locale-independent otherwise. */
  readonly locale: string | null;
  readonly nameText: string;
  readonly source: TaxonomyNameSource;
  /** Required exactly when `source === 'provider_sourced'`. */
  readonly providerKey: string | null;
  readonly createdAt: Date;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

export interface CreateTaxonomyNameInput {
  readonly id: Uuid;
  readonly taxonomyReferenceId: Uuid;
  readonly rawNameKind: string;
  readonly locale: string | null;
  readonly rawNameText: string;
  readonly rawSource: string;
  readonly providerKey: string | null;
  readonly now: Date;
}

export function createTaxonomyName(input: CreateTaxonomyNameInput): TaxonomyName {
  if (!NAME_KINDS.includes(input.rawNameKind as TaxonomyNameKind)) {
    throw invalid(
      `nameKind must be one of: ${NAME_KINDS.join(', ')}.`,
      'plants_inventory.taxonomy_name.name_kind.invalid',
      '/nameKind',
    );
  }
  const nameKind = input.rawNameKind as TaxonomyNameKind;

  if ((nameKind === 'common') !== (input.locale !== null && input.locale.trim().length > 0)) {
    throw invalid(
      "locale is required exactly for nameKind 'common'.",
      'plants_inventory.taxonomy_name.locale.linkage_invalid',
      '/locale',
    );
  }

  const nameText = input.rawNameText.trim();
  if (nameText.length === 0) {
    throw invalid(
      'nameText must not be blank.',
      'plants_inventory.taxonomy_name.name_text.blank',
      '/nameText',
    );
  }

  if (!NAME_SOURCES.includes(input.rawSource as TaxonomyNameSource)) {
    throw invalid(
      `source must be one of: ${NAME_SOURCES.join(', ')}.`,
      'plants_inventory.taxonomy_name.source.invalid',
      '/source',
    );
  }
  const source = input.rawSource as TaxonomyNameSource;

  if (
    (source === 'provider_sourced') !==
    (input.providerKey !== null && input.providerKey.trim().length > 0)
  ) {
    throw invalid(
      "providerKey is required exactly when source is 'provider_sourced'.",
      'plants_inventory.taxonomy_name.provider_key.linkage_invalid',
      '/providerKey',
    );
  }

  return {
    id: input.id,
    taxonomyReferenceId: input.taxonomyReferenceId,
    nameKind,
    locale: input.locale,
    nameText,
    source,
    providerKey: input.providerKey,
    createdAt: input.now,
  };
}
