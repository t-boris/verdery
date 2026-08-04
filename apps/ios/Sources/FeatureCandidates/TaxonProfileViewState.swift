import CoreDomain
import Foundation

/// What the taxon profile screen shows, resolved from the domain by its view
/// model so the view itself makes no decisions.
public struct TaxonProfileViewState: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        case loading
        /// No profile has been assembled for this taxon yet — a real state,
        /// not an error: enrichment simply has not produced one.
        case missing
        case loaded
        case failed(String)
    }

    public var phase: Phase = .loading
    public var facts: [TaxonProfileFact] = []
    public var images: [TaxonImage] = []
    public var isPartial: Bool = false
    public var assembledAt: Date?

    public init() {}
}
