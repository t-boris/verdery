import Foundation

/// Visual Plant Journal purpose label a photo was captured for, or — on
/// `ImageAnalysisResult.requestedViewPurposes` — a purpose a health
/// suggestion is asking for another photo of. Populated only when
/// `requestedAdditionalEvidence` is `true`.
///
/// Source: packages/api-contracts/openapi.yaml, `ObservationPhotoPurpose`.
public enum ObservationPhotoPurpose: String, Codable, Equatable, Sendable, CaseIterable {
    case wholePlant = "whole_plant"
    case leafFront = "leaf_front"
    case leafBack = "leaf_back"
    case stemOrBark = "stem_or_bark"
    case flower
    case fruit
    case symptomCloseUp = "symptom_close_up"
    case contextOrFreeForm = "context_or_free_form"
}

/// How urgently a health suggestion should prompt a human follow-up
/// (P11-HEALTH-01) — NOT a treatment recommendation. High-impact treatment
/// recommendations remain rules-first, under the separate recommendation
/// safety policy, regardless of this value.
///
/// Source: packages/api-contracts/openapi.yaml, `HealthSuggestionSafetyClass`.
public enum HealthSuggestionSafetyClass: String, Codable, Equatable, Sendable, CaseIterable {
    case informational
    case monitor
    case expertReviewRecommended = "expert_review_recommended"
}

/// `unresolved` is the default — no disposition has been recorded yet. No
/// ordering is enforced: a disposition may be reconsidered freely, matching
/// `PlantLifecycleStage`'s own "any transition is a legitimate, if inert,
/// command" posture.
///
/// Source: packages/api-contracts/openapi.yaml, `HealthSuggestionDisposition`.
public enum HealthSuggestionDisposition: String, Codable, Equatable, Sendable, CaseIterable {
    case confirmedExternally = "confirmed_externally"
    case acceptedAsObservation = "accepted_as_observation"
    case rejected
    case unresolved
}
