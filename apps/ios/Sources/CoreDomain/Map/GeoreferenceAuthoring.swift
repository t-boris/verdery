import Foundation

/// How exactly a provider claims to have located an address.
///
/// Deliberately coarse. A provider's own confidence vocabulary is its own, and
/// what somebody deciding whether to accept a pin needs to know is whether it
/// is their roof, their street, or their town.
public enum AddressPrecision: String, Sendable, Equatable, Codable {
    case streetAddress
    case street
    case area
}

/// One candidate position for a typed address.
///
/// A suggestion, never a record: nothing from the geocoder is stored. What
/// persists is the georeference anchor a person accepts, which is why this type
/// has no identifier and never reaches the local database.
public struct AddressCandidate: Sendable, Equatable, Identifiable {
    /// As the provider matched it, for a person to recognise. Never
    /// reformatted — a rewritten address is one somebody cannot check.
    public let formattedAddress: String
    /// Longitude, latitude — WGS84.
    public let position: Position
    public let precision: AddressPrecision

    public init(formattedAddress: String, position: Position, precision: AddressPrecision) {
        self.formattedAddress = formattedAddress
        self.position = position
        self.precision = precision
    }

    public var id: String { "\(formattedAddress)|\(position.x)|\(position.y)" }
}

/// The geocoder's answer, with "we could not ask" kept apart from "nothing
/// matched".
///
/// An empty list with the provider available means the address does not exist.
/// An empty list with the provider unavailable means nothing at all. Presenting
/// those as the same thing sends somebody rewriting an address that was right.
public struct AddressCandidateList: Sendable, Equatable {
    public let items: [AddressCandidate]
    public let providerAvailable: Bool

    public init(items: [AddressCandidate], providerAvailable: Bool) {
        self.items = items
        self.providerAvailable = providerAvailable
    }

    /// The address exists nowhere the provider knows of — a real answer.
    public var isDefinitelyEmpty: Bool { items.isEmpty && providerAvailable }
    /// We could not ask. Not an answer about the address at all.
    public var isUnknown: Bool { !providerAvailable }
}

/// How an anchor and its north rotation were established.
///
/// The record's own account of its origin. The server derives `provenance` from
/// it rather than accepting both — two fields describing one fact can disagree,
/// and a client should not be the one deciding which is true.
public enum GeoreferenceMethod: String, Sendable, Equatable, Codable, CaseIterable {
    /// The device's own positioning, with its reported accuracy.
    case deviceLocation
    /// A candidate returned for a typed address and accepted by the person who
    /// typed it.
    case addressSearch
    /// A point placed on imagery or a basemap.
    case mapPin
    /// Longitude and latitude entered by hand.
    case manualCoordinates
    case controlPoints
    case imageryAlignment
}

/// A georeference a person has assembled but not yet written.
///
/// Held as a value so the screen's rules are testable without a network: what
/// may be submitted, what a rotation outside `[0, 360)` means, and whether an
/// accuracy figure is a claim or an absence.
public struct GeoreferenceDraft: Sendable, Equatable {
    /// The point in garden-local metres the geographic anchor describes.
    /// Usually the space's own origin, and this screen never offers another —
    /// anchoring somewhere else is a survey decision, not a phone decision.
    public var localAnchor: Position
    /// Longitude, latitude — WGS84.
    public var geographicAnchor: Position?
    /// Clockwise from the local `+Y` axis to true north.
    public var rotationDegrees: Double
    /// Reported accuracy of the geographic anchor. `nil` means "not
    /// expressed", never "exact".
    public var accuracyMetres: Double?
    /// A human-readable label confirmed for this anchor. Never geometric
    /// authority — it is there so somebody can recognise the place.
    public var displayAddress: String?
    public var method: GeoreferenceMethod

    public init(
        localAnchor: Position = Position(x: 0, y: 0),
        geographicAnchor: Position? = nil,
        rotationDegrees: Double = 0,
        accuracyMetres: Double? = nil,
        displayAddress: String? = nil,
        method: GeoreferenceMethod = .mapPin
    ) {
        self.localAnchor = localAnchor
        self.geographicAnchor = geographicAnchor
        self.rotationDegrees = rotationDegrees
        self.accuracyMetres = accuracyMetres
        self.displayAddress = displayAddress
        self.method = method
    }

    /// An anchor is the whole request; without one there is nothing to send.
    public var canSubmit: Bool { geographicAnchor != nil }

    /// The contract rejects a rotation outside `[0, 360)` rather than
    /// normalising it, on the grounds that a client which computed `-5` or
    /// `370` has a bug worth seeing. A *dial*, though, does not have that bug:
    /// turning past north is what a dial does, and it means one full turn. So
    /// the wrap happens here, at the one place where it is a gesture and not a
    /// miscalculation, and the value that leaves is always in range.
    public static func normalizedRotation(_ degrees: Double) -> Double {
        let wrapped = degrees.truncatingRemainder(dividingBy: 360)
        return wrapped < 0 ? wrapped + 360 : wrapped
    }

    public var normalizedRotationDegrees: Double {
        Self.normalizedRotation(rotationDegrees)
    }

    /// Applying a chosen address candidate. The method follows the gesture,
    /// because the method IS the account of how this anchor came to be.
    public mutating func accept(_ candidate: AddressCandidate) {
        geographicAnchor = candidate.position
        displayAddress = candidate.formattedAddress
        method = .addressSearch
        // A geocoder reports no accuracy figure, and inventing one from the
        // precision class would be a claim the provider never made.
        accuracyMetres = nil
    }

    /// Applying a device fix. The accuracy is carried because it is the one
    /// method that actually reports one.
    public mutating func acceptDeviceLocation(_ position: Position, accuracyMetres: Double?) {
        geographicAnchor = position
        self.accuracyMetres = accuracyMetres
        displayAddress = nil
        method = .deviceLocation
    }

    /// Applying a dragged pin.
    public mutating func acceptPin(_ position: Position) {
        geographicAnchor = position
        accuracyMetres = nil
        displayAddress = nil
        method = .mapPin
    }
}
