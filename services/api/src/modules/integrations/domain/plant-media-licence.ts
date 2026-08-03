/**
 * Which licences permit this product to store and show a provider's image,
 * and which do not.
 *
 * GBIF returns a licence PER OCCURRENCE RECORD, and one result set mixes
 * CC0, CC-BY and CC-BY-NC — verified live and recorded in the provider
 * runbook (§3.1) and in `gbif-payload.ts`'s own header, which states that a
 * pass fetching individual records "must read `license` per record, never
 * assume one for the whole response". This module is where that rule lives.
 *
 * THE NON-COMMERCIAL PROBLEM: CC-BY-NC forbids commercial use. Verdery is
 * not a non-commercial product, so an NC-licensed photograph cannot be
 * ingested, cached, or displayed here at all — not with attribution, not
 * behind a notice. It is refused, and the refusal is the point of this file.
 *
 * ATTRIBUTION IS NOT OPTIONAL EITHER: CC-BY requires crediting the rights
 * holder wherever the image appears, so a CC-BY asset without a readable
 * rights holder is refused too. Ingesting an image this application cannot
 * legally attribute would be a licence breach dressed as a missing field.
 *
 * UNRECOGNISED MEANS REFUSED. A licence string this module does not know is
 * not "probably fine" — it is unassessed, and the safe reading of an
 * unassessed licence is no.
 *
 * Source: docs/development/plant-knowledge-provider-runbooks.md, section 3.1;
 * architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md,
 * section 3 (`plant_media_asset`); tasks/todo.md, "Taxon imagery — GBIF
 * media, with a licence rule the runbook already found".
 */

/** The licences under which this product may store and display a provider image. */
export type IngestibleMediaLicence = 'cc0' | 'cc_by';

/**
 * Licence strings seen from providers, mapped to what they permit.
 *
 * Keys are normalized (lowercased, trimmed, protocol and trailing slash
 * removed) because providers spell the same licence several ways — GBIF
 * returns URLs, some records return SPDX-style identifiers, and the version
 * suffix varies.
 */
const LICENCE_BY_NORMALIZED_FORM = new Map<string, IngestibleMediaLicence>([
  ['creativecommons.org/publicdomain/zero/1.0', 'cc0'],
  ['creativecommons.org/publicdomain/zero/1.0/legalcode', 'cc0'],
  ['cc0-1.0', 'cc0'],
  ['cc0', 'cc0'],
  ['creativecommons.org/licenses/by/4.0', 'cc_by'],
  ['creativecommons.org/licenses/by/4.0/legalcode', 'cc_by'],
  ['creativecommons.org/licenses/by/3.0', 'cc_by'],
  ['cc-by-4.0', 'cc_by'],
  ['cc-by', 'cc_by'],
]);

/**
 * Why an asset was refused. Recorded rather than discarded silently: a
 * provider that suddenly returns nothing ingestible is an operational
 * signal, and "every record was non-commercial" and "the field was missing"
 * call for different responses.
 */
export type MediaLicenceRefusal =
  'non_commercial' | 'licence_absent' | 'licence_unrecognised' | 'rights_holder_absent';

export type MediaLicenceDecision =
  | { readonly ingestible: true; readonly licence: IngestibleMediaLicence }
  | { readonly ingestible: false; readonly refusal: MediaLicenceRefusal };

function normalize(licence: string): string {
  return licence
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

/** True when the string names a non-commercial licence, in any spelling seen so far. */
function isNonCommercial(normalized: string): boolean {
  return normalized.includes('/by-nc') || normalized.startsWith('cc-by-nc');
}

/**
 * Whether one provider image may be stored and shown.
 *
 * `rightsHolder` is required for CC-BY and ignored for CC0, which imposes no
 * attribution condition.
 */
export function decideMediaLicence(
  rawLicence: string | null | undefined,
  rightsHolder: string | null | undefined,
): MediaLicenceDecision {
  if (typeof rawLicence !== 'string' || rawLicence.trim() === '') {
    return { ingestible: false, refusal: 'licence_absent' };
  }

  const normalized = normalize(rawLicence);

  // Checked before the lookup, not after: an NC licence must never depend on
  // being absent from the permitted map to be refused.
  if (isNonCommercial(normalized)) {
    return { ingestible: false, refusal: 'non_commercial' };
  }

  const licence = LICENCE_BY_NORMALIZED_FORM.get(normalized);
  if (licence === undefined) {
    return { ingestible: false, refusal: 'licence_unrecognised' };
  }

  if (licence === 'cc_by' && (typeof rightsHolder !== 'string' || rightsHolder.trim() === '')) {
    return { ingestible: false, refusal: 'rights_holder_absent' };
  }

  return { ingestible: true, licence };
}
