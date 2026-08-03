/**
 * Which licences let this product SHOW a provider's taxon image, and which
 * do not.
 *
 * `integrations.plant_media_asset` deliberately stores every licence a
 * source claims, including the ones this product cannot use — its own
 * migration header explains why: "presentation ELIGIBILITY is an
 * application-layer decision that can evolve without a migration each time a
 * license category's standing changes; the column only records what the
 * source actually claims". This module is that application-layer decision,
 * and the reason an asset sits at `ingestion_state = 'rejected'` rather than
 * vanishing.
 *
 * The allowlist is not invented here. The design doc states it: "The initial
 * commercial-media allowlist is Public Domain, CC0, and CC BY. CC BY-SA
 * requires an approved compliance design. CC BY-NC, incompatible
 * no-derivatives use, unknown licenses, and withdrawn media are not eligible
 * for product presentation."
 *
 * WHY CC-BY-NC MATTERS IN PRACTICE: GBIF returns a licence per occurrence
 * record and mixes CC0, CC-BY and CC-BY-NC within one result set — verified
 * live and recorded in the provider runbook (§3.1), whose own note says a
 * pass reading individual records must read the licence per record and never
 * assume one for the whole response. A single response therefore yields both
 * usable and unusable images, and only a per-asset decision separates them.
 *
 * ATTRIBUTION IS PART OF THE LICENCE. CC-BY requires crediting the rights
 * holder wherever the image appears, so a CC-BY asset with no readable
 * rights holder is not eligible: showing an image this application cannot
 * credit would breach the licence that permitted it.
 *
 * Source: architecture/plant-intelligence-and-visual-journal.md, section 7
 * (commercial-media allowlist); docs/development/plant-knowledge-provider-runbooks.md,
 * section 3.1; migrations/1787700000000_plant-taxon-knowledge-profile.sql.
 */

/**
 * Every licence value `integrations.plant_media_asset.license` accepts —
 * what a source claims, not what may be shown.
 */
export type PlantMediaLicence =
  'public_domain' | 'cc0' | 'cc_by' | 'cc_by_sa' | 'cc_by_nc' | 'unknown' | 'withdrawn';

/** The design doc's allowlist, verbatim: Public Domain, CC0, and CC BY. */
const PRESENTABLE_LICENCES = new Set<PlantMediaLicence>(['public_domain', 'cc0', 'cc_by']);

/** Attribution-bearing licences: eligible only when a rights holder is known. */
const ATTRIBUTION_REQUIRED = new Set<PlantMediaLicence>(['cc_by']);

/**
 * Why an asset may not be presented.
 *
 * Recorded rather than collapsed into one "no": a provider whose whole
 * response is non-commercial and one that stopped sending licences at all
 * are different operational situations, and `cc_by_sa` is the only reason
 * here that a decision could legitimately reverse.
 */
export type PlantMediaIneligibility =
  | 'non_commercial'
  | 'share_alike_pending_compliance_design'
  | 'licence_unknown'
  | 'withdrawn'
  | 'rights_holder_absent';

export type PlantMediaEligibility =
  | { readonly presentable: true }
  | { readonly presentable: false; readonly reason: PlantMediaIneligibility };

function ineligible(reason: PlantMediaIneligibility): PlantMediaEligibility {
  return { presentable: false, reason };
}

/**
 * Whether one stored asset may be shown to a user.
 *
 * Takes the licence as stored, so this answers the same question for a row
 * being considered for ingestion and for a row already in the table — a
 * licence category's standing can change, and re-running this over stored
 * rows is exactly how that change takes effect.
 */
export function decidePlantMediaEligibility(
  licence: PlantMediaLicence,
  rightsHolder: string | null,
): PlantMediaEligibility {
  if (licence === 'cc_by_nc') {
    return ineligible('non_commercial');
  }
  if (licence === 'cc_by_sa') {
    // Not a refusal on principle: ShareAlike obligations can propagate to
    // adapted material, and this application's media pipeline generates
    // derivatives. Eligible once that compliance design is approved.
    return ineligible('share_alike_pending_compliance_design');
  }
  if (licence === 'withdrawn') {
    return ineligible('withdrawn');
  }
  if (!PRESENTABLE_LICENCES.has(licence)) {
    // `unknown`, and any value a future migration adds without revisiting
    // this rule. An unassessed licence is not a permissive one.
    return ineligible('licence_unknown');
  }
  if (ATTRIBUTION_REQUIRED.has(licence) && (rightsHolder === null || rightsHolder.trim() === '')) {
    return ineligible('rights_holder_absent');
  }

  return { presentable: true };
}

/**
 * Provider licence strings mapped onto the stored vocabulary.
 *
 * GBIF returns URLs; other sources return SPDX-style identifiers. Anything
 * unrecognised becomes `unknown`, which is stored honestly and then found
 * ineligible above — never silently dropped, so "how many assets did we
 * refuse and why" stays answerable.
 */
export function parseProviderLicence(rawLicence: string | null | undefined): PlantMediaLicence {
  if (typeof rawLicence !== 'string' || rawLicence.trim() === '') {
    return 'unknown';
  }

  const normalized = rawLicence
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');

  // Order matters: `by-nc-sa` must read as non-commercial, not ShareAlike.
  if (normalized.includes('/by-nc') || normalized.startsWith('cc-by-nc')) {
    return 'cc_by_nc';
  }
  if (normalized.includes('/by-sa') || normalized.startsWith('cc-by-sa')) {
    return 'cc_by_sa';
  }
  if (normalized.includes('publicdomain/zero') || normalized.startsWith('cc0')) {
    return 'cc0';
  }
  if (normalized.includes('publicdomain/mark') || normalized === 'public-domain') {
    return 'public_domain';
  }
  if (normalized.includes('/licenses/by/') || normalized.startsWith('cc-by')) {
    return 'cc_by';
  }

  return 'unknown';
}
