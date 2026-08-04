import Foundation

/// One licensed reference image for a taxon — what the species looks like,
/// as distinct from a gardener's photographs of their own plant.
///
/// Only images this product may actually show ever reach a client: the
/// commercial-media allowlist is applied on the server, so this app never
/// decides a licence question. `attribution` is present whenever the licence
/// requires a credit, and must be displayed with the image — for CC BY it is
/// the condition the licence was granted under, not a nicety.
public struct TaxonImage: Equatable, Sendable, Identifiable {
    public let id: String
    public let sourceUrl: URL
    public let license: String
    public let attribution: String?
    /// Which part of the plant is pictured, when the source says. `nil` rather than a guess.
    public let organ: String?

    public init(id: String, sourceUrl: URL, license: String, attribution: String?, organ: String?) {
        self.id = id
        self.sourceUrl = sourceUrl
        self.license = license
        self.attribution = attribution
        self.organ = organ
    }
}

/// One resolved fact in a taxon profile, with the source that asserted it.
public struct TaxonProfileFact: Equatable, Sendable, Identifiable {
    public var id: String { factKey }
    public let factKey: String
    public let displayValue: String
    public let unit: String?
    public let providerKey: String
    public let sourceCitation: String?

    public init(
        factKey: String,
        displayValue: String,
        unit: String?,
        providerKey: String,
        sourceCitation: String?
    ) {
        self.factKey = factKey
        self.displayValue = displayValue
        self.unit = unit
        self.providerKey = providerKey
        self.sourceCitation = sourceCitation
    }
}

/// The taxon profile read: the materialized fact projection plus the imagery
/// permitted to accompany it.
///
/// `isPartial` is carried, not hidden: it says at least one fact key sources
/// describe never resolved, which is a different statement from "this plant
/// has no such property".
public struct TaxonProfile: Equatable, Sendable {
    public let id: String
    public let taxonomyReferenceId: String
    public let facts: [TaxonProfileFact]
    public let isPartial: Bool
    public let assembledAt: Date
    public let images: [TaxonImage]

    public init(
        id: String,
        taxonomyReferenceId: String,
        facts: [TaxonProfileFact],
        isPartial: Bool,
        assembledAt: Date,
        images: [TaxonImage]
    ) {
        self.id = id
        self.taxonomyReferenceId = taxonomyReferenceId
        self.facts = facts
        self.isPartial = isPartial
        self.assembledAt = assembledAt
        self.images = images
    }
}
