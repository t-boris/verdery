/**
 * Normalized plant-content record: external-integrations.md section 8 and
 * data-and-geospatial-design.md section 20's field lists as an immutable,
 * append-only domain value — the provider-neutral shape every plant-content
 * adapter's output is converted into before anything else in this system may
 * read it ("Provider SDK and payload types remain inside the adapter",
 * section 2).
 *
 * Anchoring: content belongs to the PROVIDER's own taxon identity
 * (`providerKey` + `providerTaxonId`), deliberately never to an application
 * taxonomy or plant. Which application identity a record speaks about is
 * resolved at read time through the live `PlantTaxonomyMapping`, so a
 * provider reorganization can never silently re-identify stored content —
 * and a user's own declared plant facts live in plants-inventory tables this
 * record cannot reference at all (the user-fact separation, structural).
 *
 * Content vocabulary: exactly two normalized sections (`description`,
 * `careGuidance`), both licensed provider text. A per-care-category
 * structure would need the care-category glossary P0-PROD-03 has not
 * decided; images need the media pipeline (a documented deferral). Each
 * section is nullable — "Missing facts remain missing" applies to provider
 * content too — but at least one must be present.
 *
 * Source: migrations/1785900000000_integrations-plant-content-baseline.sql,
 * `integrations.plant_content_record`;
 * architecture/external-integrations.md, section "8. Plant Content";
 * architecture/data-and-geospatial-design.md, section "20. External
 * Reference Data".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** The two normalized licensed text sections. Nullable individually; at least one must be present. */
export interface PlantContentSections {
  readonly description: string | null;
  readonly careGuidance: string | null;
}

/**
 * Section 8's "source, version/fetch time" half that comes from the
 * provider's own payload: its content-record identifier and version marker
 * where it supplies them (never invented), and the language the content is
 * written in — a normalization essential in a bilingual application.
 */
export interface PlantContentSource {
  readonly providerRecordId: string | null;
  readonly providerContentVersion: string | null;
  readonly contentLanguage: string;
}

export interface PlantContentRecord {
  readonly id: Uuid;
  /** The application-owned registry key of the adapter that produced this row — never a provider SDK identifier. */
  readonly providerKey: string;
  /** The provider's own taxonomy identifier this content is about. */
  readonly providerTaxonId: string;
  readonly source: PlantContentSource;
  readonly sections: PlantContentSections;
  /** The moment this system retrieved it — the basis for the refetch-window cache rule. */
  readonly fetchedAt: Date;
  /** License and redistribution constraints snapshot, from the registry entry that produced the row. */
  readonly licenseNote: string;
  readonly attributionText: string | null;
  /** The jurisdiction the provider's terms name, where they name one (section 8). */
  readonly jurisdiction: string | null;
  /** The allowed presentation behavior the provider's terms grant (section 8) — always declared, snapshotted per row. */
  readonly presentationNote: string;
  readonly createdAt: Date;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

function requireNonBlank(value: string, code: string, pointer: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalid(`${label} must not be blank.`, code, pointer);
  }
  return trimmed;
}

function optionalNonBlank(
  value: string | null,
  code: string,
  pointer: string,
  label: string,
): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalid(`${label} must not be blank when present.`, code, pointer);
  }
  return trimmed;
}

/** Mirrors the section CHECKs: each present section non-blank, and at least one present. */
export function validatePlantContentSections(sections: PlantContentSections): PlantContentSections {
  const description = optionalNonBlank(
    sections.description,
    'integrations.plant_content_record.description.blank',
    '/sections/description',
    'sections.description',
  );
  const careGuidance = optionalNonBlank(
    sections.careGuidance,
    'integrations.plant_content_record.care_guidance.blank',
    '/sections/careGuidance',
    'sections.careGuidance',
  );
  if (description === null && careGuidance === null) {
    throw invalid(
      'At least one content section must be present.',
      'integrations.plant_content_record.sections.empty',
      '/sections',
    );
  }
  return { description, careGuidance };
}

/** Mirrors the provider-record-id, content-version, and content-language CHECKs. */
export function validatePlantContentSource(source: PlantContentSource): PlantContentSource {
  return {
    providerRecordId: optionalNonBlank(
      source.providerRecordId,
      'integrations.plant_content_record.provider_record_id.blank',
      '/source/providerRecordId',
      'source.providerRecordId',
    ),
    providerContentVersion: optionalNonBlank(
      source.providerContentVersion,
      'integrations.plant_content_record.content_version.blank',
      '/source/providerContentVersion',
      'source.providerContentVersion',
    ),
    contentLanguage: requireNonBlank(
      source.contentLanguage,
      'integrations.plant_content_record.content_language.blank',
      '/source/contentLanguage',
      'source.contentLanguage',
    ),
  };
}

export interface CreatePlantContentRecordInput {
  readonly id: Uuid;
  readonly rawProviderKey: string;
  readonly rawProviderTaxonId: string;
  readonly source: PlantContentSource;
  readonly sections: PlantContentSections;
  readonly fetchedAt: Date;
  readonly rawLicenseNote: string;
  readonly attributionText: string | null;
  readonly jurisdiction: string | null;
  readonly rawPresentationNote: string;
  readonly now: Date;
}

/**
 * Constructs a normalized plant-content record, enforcing every migration
 * CHECK as a clean `ValidationError` before the row exists.
 */
export function createPlantContentRecord(input: CreatePlantContentRecordInput): PlantContentRecord {
  return {
    id: input.id,
    providerKey: requireNonBlank(
      input.rawProviderKey,
      'integrations.plant_content_record.provider_key.blank',
      '/providerKey',
      'providerKey',
    ),
    providerTaxonId: requireNonBlank(
      input.rawProviderTaxonId,
      'integrations.plant_content_record.provider_taxon_id.blank',
      '/providerTaxonId',
      'providerTaxonId',
    ),
    source: validatePlantContentSource(input.source),
    sections: validatePlantContentSections(input.sections),
    fetchedAt: input.fetchedAt,
    licenseNote: requireNonBlank(
      input.rawLicenseNote,
      'integrations.plant_content_record.license_note.blank',
      '/licenseNote',
      'licenseNote',
    ),
    attributionText: optionalNonBlank(
      input.attributionText,
      'integrations.plant_content_record.attribution_text.blank',
      '/attributionText',
      'attributionText',
    ),
    jurisdiction: optionalNonBlank(
      input.jurisdiction,
      'integrations.plant_content_record.jurisdiction.blank',
      '/jurisdiction',
      'jurisdiction',
    ),
    presentationNote: requireNonBlank(
      input.rawPresentationNote,
      'integrations.plant_content_record.presentation_note.blank',
      '/presentationNote',
      'presentationNote',
    ),
    createdAt: input.now,
  };
}
