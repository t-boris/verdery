/**
 * Provider-neutral plant-species-identification port — a second AI use
 * case alongside `ai-explanation-provider.ts`, drawn behind the same
 * boundary (external-integrations.md section 2: "domain/application →
 * provider-neutral port → provider adapter → external API").
 *
 * Approved by ADR-0015, which redirects Phase 10 toward real photo-based
 * plant identification. The one approved use case: given a reference to
 * an already-uploaded plant photo, suggest a common/scientific name
 * candidate with a confidence score. This is species MATCHING, not fact
 * generation — the suggestion is later resolved against this
 * application's own reviewed taxonomy catalog
 * (`TaxonomyReferenceRepository.search`), and the caller
 * (`identifyPlantFromPhoto`) never treats a candidate name as a
 * `taxonomyReferenceId` by itself. The adapter never receives or reports
 * anything about toxicity or edibility — those fields do not exist on
 * this port's request or response shape, structurally, not by
 * convention (ADR-0013: that data is human-authored from a cited
 * source, never AI-authored).
 *
 * A separate port from `AiExplanationProviderAdapter`, per this module's
 * own established rule (`ai-explanation-provider.ts`'s header: "no
 * generic multi-purpose AI port") — image-in/candidate-out is a
 * different use case from text-in/text-out explanation rephrasing, with
 * its own schema and its own evolution path.
 *
 * Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md;
 * architecture/decisions/ADR-0013-ai-assisted-care-content-authoring.md;
 * architecture/decisions/ADR-0008-rules-first-recommendations-and-vertex-ai.md.
 */

/** A reference to an already-uploaded, already-validated image in Cloud Storage — never raw bytes crossing this port (matches the "references, never bytes" posture the async worker manifests already use). */
export interface PlantPhotoReference {
  readonly bucketName: string;
  readonly objectKey: string;
  readonly mimeType: string;
  /**
   * The object's size. Carried because every provider has a limit and a
   * request above it cannot succeed — spending the call anyway costs money
   * and returns a failure indistinguishable from "the model saw nothing".
   */
  readonly byteSize: number;
}

export interface PlantSpeciesIdentificationRequest {
  readonly photo: PlantPhotoReference;
}

/** The model's own candidate name guess — resolved against the real taxonomy catalog by the caller, never trusted as a database identifier itself. */
export interface PlantSpeciesCandidate {
  readonly commonName: string;
  readonly scientificNameGuess: string | null;
  readonly familyNameGuess: string | null;
  readonly genusNameGuess: string | null;
  readonly confidenceScore: number;
  /** e.g. "Cherry Tomato" vs the plain `commonName` "Tomato" — `null` when the model saw nothing distinct from the species itself. */
  readonly varietyGuess: string | null;
  /**
   * One of `LifecycleStage`'s own values (`plants-inventory`'s domain
   * vocabulary — this port stays free of that module's types, so this is a
   * plain string the caller validates), excluding `'planned'`: a
   * photographed plant is never in the pre-planting stage. `null` when the
   * model was not confident, or the concept does not apply to what it saw
   * (e.g. a mature tree) — the same "do not guess" posture
   * `noConfidentCandidate` already establishes for the species guess itself.
   */
  readonly lifecycleStageGuess: string | null;
  /**
   * An approximate calendar date (`YYYY-MM-DD`) this plant was likely
   * planted/acquired, estimated from visible maturity — never a bare guess
   * with no grounding in what the photo actually shows. `null` when the
   * model was not confident, the same "do not guess" posture every other
   * suggested field here already establishes.
   */
  readonly acquisitionDateGuess: string | null;
  /** Best visible-maturity age range. Both bounds are whole months and the minimum never exceeds the maximum. */
  readonly estimatedAgeMonthsMin: number;
  readonly estimatedAgeMonthsMax: number;
}

export interface PlantIdentificationModelIdentity {
  readonly model: string;
  readonly promptTemplateVersion: number;
}

/**
 * `noConfidentCandidate` is the model's own honest "I don't recognize
 * this" — distinct from `schemaInvalid` (the model answered but not in
 * the required shape) and `safetyBlocked` (the provider's own safety
 * filter). All three are non-fabrication outcomes the caller must treat
 * identically to the historical stub's `{ suggestedTaxonomyId: null,
 * confidenceScore: 0 }` — never treated as a database error.
 */
export type PlantSpeciesIdentificationAdapterOutcome =
  | { readonly kind: 'candidate'; readonly candidate: PlantSpeciesCandidate }
  | { readonly kind: 'noConfidentCandidate' }
  | { readonly kind: 'schemaInvalid'; readonly rawText: string | null }
  | { readonly kind: 'safetyBlocked' };

export interface PlantSpeciesIdentificationProviderAdapter {
  readonly identity: PlantIdentificationModelIdentity;

  /** May reject with anything; the caller converts every failure into a typed degradation, matching `GenerateAiExplanation`'s own posture. */
  identifySpecies(
    request: PlantSpeciesIdentificationRequest,
    signal: AbortSignal,
  ): Promise<PlantSpeciesIdentificationAdapterOutcome>;
}
