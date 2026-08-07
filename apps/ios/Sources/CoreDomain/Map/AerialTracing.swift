import Foundation

/// Whether a photograph showed this, or something else implied it.
public enum AerialEvidence: String, Sendable, Equatable, Codable {
    /// Visible in the imagery. The stronger claim.
    case visible
    /// Inferred from context rather than seen. Kept apart from `visible`
    /// because a reviewer deciding whether to accept a shape is entitled to
    /// know which of the two it is.
    case inferred
}

/// One shape an aerial photograph appears to show.
public struct AerialTracingProposal: Sendable, Equatable, Identifiable {
    public let id: String
    public let category: GardenObjectCategory
    public let label: String
    public let geometry: Geometry
    public let confidence: Double
    public let evidence: AerialEvidence

    public init(
        id: String,
        category: GardenObjectCategory,
        label: String,
        geometry: Geometry,
        confidence: Double,
        evidence: AerialEvidence
    ) {
        self.id = id
        self.category = category
        self.label = label
        self.geometry = geometry
        self.confidence = confidence
        self.evidence = evidence
    }
}

/// What an aerial photograph appears to show over a georeferenced garden.
///
/// Proposals, never geometry. The imagery is a backdrop and tracing over it is
/// the person's own drawing — which is exactly why the disclaimer travels with
/// the result and is rendered rather than summarised.
public struct AerialTracing: Sendable, Equatable {
    /// The imagery this was read from, so a reviewer knows what they are
    /// trusting.
    public let source: String
    /// Rendered verbatim beside the proposals. It is the provider's own
    /// statement about what the imagery can and cannot support, and paraphrasing
    /// it would be this application making that claim instead.
    public let disclaimer: String
    public let proposals: [AerialTracingProposal]

    public init(source: String, disclaimer: String, proposals: [AerialTracingProposal]) {
        self.source = source
        self.disclaimer = disclaimer
        self.proposals = proposals
    }

    /// What a reviewer starts ready to accept: only what was actually seen.
    ///
    /// An inferred shape is offered but never pre-checked. Accepting a hedge
    /// nobody photographed, because a box was already ticked, is how a garden
    /// acquires a fence that is not there.
    public var preSelectedIds: Set<String> {
        Set(proposals.filter { $0.evidence == .visible }.map(\.id))
    }
}
