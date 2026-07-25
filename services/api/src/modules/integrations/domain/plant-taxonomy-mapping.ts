/**
 * Provider-taxonomy identity mapping: external-integrations.md section 8's
 * separation of "stable application taxonomy identifiers" from "provider
 * taxonomy identifiers", as a domain value.
 *
 * Direction is the whole point: the application's own
 * `plants_inventory.taxonomy_reference` id (the catalog P4 built) is the
 * STABLE key, and one provider taxon maps INTO it. The mapping's identity
 * triple (`taxonomyReferenceId`, `providerKey`, `providerTaxonId`) is
 * immutable after creation — correcting a wrong mapping means rejecting the
 * row and creating a new one, never re-pointing in place — so a provider's
 * reorganization can never silently re-identify the application's plants:
 * every identity change is a durable, auditable pair of rows.
 *
 * Verification state is the one mutable fact, along a one-way lifecycle:
 * every machine-created mapping starts `unverified` (no human was involved
 * and nothing pretends otherwise — the launch-rule
 * `awaiting_horticultural_review` honesty posture), a future human
 * verification surface moves it to `verified`, and `rejected` is terminal
 * either way. `confidence` is the provider's own match confidence where
 * supplied, never invented ("Missing facts remain missing").
 *
 * Source: migrations/1785900000000_integrations-plant-content-baseline.sql,
 * `integrations.plant_taxonomy_mapping`;
 * architecture/external-integrations.md, sections "4. Provider Registry" and
 * "8. Plant Content".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type TaxonomyMappingVerificationState = 'unverified' | 'verified' | 'rejected';

export interface PlantTaxonomyMapping {
  readonly id: Uuid;
  /** The stable application taxonomy identity — `plants_inventory.taxonomy_reference.id`. */
  readonly taxonomyReferenceId: Uuid;
  /** The application-owned registry key of the provider this mapping belongs to. */
  readonly providerKey: string;
  /** The provider's own taxonomy identifier. */
  readonly providerTaxonId: string;
  /** What the provider called the taxon when this mapping was made — a drift-detection snapshot, where supplied. */
  readonly providerScientificName: string | null;
  /** The provider's own match confidence in [0, 1], where supplied — never invented. */
  readonly confidence: number | null;
  readonly verificationState: TaxonomyMappingVerificationState;
  /** Why the state last changed (e.g. a rejection reason), where one was given. */
  readonly stateNote: string | null;
  readonly stateChangedAt: Date;
  readonly createdAt: Date;
}

function invalid(message: string, code: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

/** Mirrors the confidence range CHECK; also rejects NaN/Infinity, which a CHECK cannot see coming from JS. */
export function validateMappingConfidence(confidence: number | null): number | null {
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw invalid(
      'confidence must be a finite number between 0 and 1.',
      'integrations.plant_taxonomy_mapping.confidence.invalid',
      '/confidence',
    );
  }
  return confidence;
}

export interface CreatePlantTaxonomyMappingInput {
  readonly id: Uuid;
  readonly taxonomyReferenceId: Uuid;
  readonly rawProviderKey: string;
  readonly rawProviderTaxonId: string;
  readonly providerScientificName: string | null;
  readonly confidence: number | null;
  readonly now: Date;
}

/**
 * Constructs a new mapping, enforcing every migration CHECK as a clean
 * `ValidationError` before the row exists. The verification state is pinned
 * to `unverified` — a machine-created mapping cannot claim a human verified
 * it.
 */
export function createPlantTaxonomyMapping(
  input: CreatePlantTaxonomyMappingInput,
): PlantTaxonomyMapping {
  const providerKey = input.rawProviderKey.trim();
  if (providerKey.length === 0) {
    throw invalid(
      'providerKey must not be blank.',
      'integrations.plant_taxonomy_mapping.provider_key.blank',
      '/providerKey',
    );
  }
  const providerTaxonId = input.rawProviderTaxonId.trim();
  if (providerTaxonId.length === 0) {
    throw invalid(
      'providerTaxonId must not be blank.',
      'integrations.plant_taxonomy_mapping.provider_taxon_id.blank',
      '/providerTaxonId',
    );
  }
  const providerScientificName = input.providerScientificName?.trim() ?? null;
  if (providerScientificName !== null && providerScientificName.length === 0) {
    throw invalid(
      'providerScientificName must not be blank when present.',
      'integrations.plant_taxonomy_mapping.scientific_name.blank',
      '/providerScientificName',
    );
  }

  return {
    id: input.id,
    taxonomyReferenceId: input.taxonomyReferenceId,
    providerKey,
    providerTaxonId,
    providerScientificName,
    confidence: validateMappingConfidence(input.confidence),
    verificationState: 'unverified',
    stateNote: null,
    stateChangedAt: input.now,
    createdAt: input.now,
  };
}

/**
 * The one-way verification lifecycle: `unverified -> verified`,
 * `unverified -> rejected`, `verified -> rejected`. Nothing leaves
 * `rejected` (a rejected identity claim is history, not a draft), and
 * nothing returns to `unverified` (un-verifying would erase a human
 * judgment silently). Throws a `ValidationError` on any other move.
 */
export function validateMappingStateTransition(
  from: TaxonomyMappingVerificationState,
  to: TaxonomyMappingVerificationState,
): void {
  const allowed =
    (from === 'unverified' && (to === 'verified' || to === 'rejected')) ||
    (from === 'verified' && to === 'rejected');
  if (!allowed) {
    throw invalid(
      `A mapping cannot move from '${from}' to '${to}'.`,
      'integrations.plant_taxonomy_mapping.verification_state.invalid_transition',
      '/verificationState',
    );
  }
}
