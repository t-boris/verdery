import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// Placing a garden on the Earth.
///
/// Three ways in, and they are genuinely different rather than three routes to
/// one field: a device fix knows its own accuracy, a geocoder knows an address
/// but no accuracy, and a dropped pin knows neither and claims neither. The
/// draft carries which one produced it, because that is the record's own
/// account of where it came from — and the server derives provenance from it
/// rather than accepting a second field that could disagree.
///
/// Nothing here changes local geometry. Moving the anchor re-projects where the
/// garden is drawn on a basemap; it never moves the metres between two beds,
/// and the screen says so before anybody worries.
@MainActor
@Observable
public final class GeoreferenceViewModel {
    public enum SearchState: Equatable {
        case idle
        case searching
        case results([AddressCandidate])
        /// The address matched nothing, and the provider was reachable. A real
        /// answer about the address.
        case noMatches
        /// We could not ask. Says nothing about the address at all.
        case providerUnavailable
    }

    public private(set) var draft = GeoreferenceDraft()
    public private(set) var existing: GardenGeoreference?
    public private(set) var searchState: SearchState = .idle
    public private(set) var isSaving = false
    public private(set) var statusMessage: String?
    public private(set) var failureMessage: String?
    public private(set) var isLocating = false
    public private(set) var isLocationDenied = false
    /// A heading the device offered. Never applied on its own: the map design
    /// requires device heading to be proposed evidence and never to silently
    /// change an accepted orientation.
    public private(set) var proposedHeadingDegrees: Double?

    public var query = ""

    private let gardenId: String
    private let gateway: any GeographyGateway
    private let locate: () async -> DeviceFix?
    private let heading: () async -> Double?
    /// Module-internal, not `private`: read by
    /// `GeoreferenceViewModel+Text.swift`, a same-type extension in another
    /// file, which `private` (a file scope, not a type scope) would exclude.
    let strings: LocalizedStrings

    /// A device fix, kept as a plain value so this model needs no CoreLocation
    /// and stays testable — and buildable on the headless macOS target.
    public struct DeviceFix: Sendable, Equatable {
        public let position: Position
        public let accuracyMetres: Double?
        public let isDenied: Bool

        public init(position: Position, accuracyMetres: Double?, isDenied: Bool = false) {
            self.position = position
            self.accuracyMetres = accuracyMetres
            self.isDenied = isDenied
        }

        /// The refusal case, which is not a position at all.
        public static let denied = DeviceFix(
            position: Position(x: 0, y: 0),
            accuracyMetres: nil,
            isDenied: true
        )
    }

    public init(
        gardenId: String,
        existing: GardenGeoreference?,
        gateway: any GeographyGateway,
        strings: LocalizedStrings,
        locate: @escaping () async -> DeviceFix? = { nil },
        heading: @escaping () async -> Double? = { nil }
    ) {
        self.gardenId = gardenId
        self.existing = existing
        self.gateway = gateway
        self.strings = strings
        self.locate = locate
        self.heading = heading

        // An existing record seeds the draft, so re-opening the screen shows
        // what is current rather than an empty one — and a small correction is
        // a small correction rather than a re-entry.
        if let existing {
            draft = GeoreferenceDraft(
                localAnchor: existing.localAnchor,
                geographicAnchor: existing.geographicAnchor,
                rotationDegrees: existing.rotationDegrees,
                accuracyMetres: existing.accuracyMetres,
                displayAddress: nil,
                method: GeoreferenceMethod(rawValue: existing.method) ?? .mapPin
            )
        }
    }

    // MARK: - The three ways in

    public func useDeviceLocation() async {
        isLocating = true
        defer { isLocating = false }
        guard let fix = await locate() else { return }
        guard !fix.isDenied else {
            isLocationDenied = true
            return
        }
        isLocationDenied = false
        draft.acceptDeviceLocation(fix.position, accuracyMetres: fix.accuracyMetres)
    }

    public func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        // The contract's own floor. Refusing here spends no request and says
        // the same thing sooner.
        guard trimmed.count >= 3 else {
            searchState = .idle
            return
        }

        searchState = .searching
        do {
            let result = try await gateway.findAddressCandidates(query: trimmed)
            if result.isUnknown {
                searchState = .providerUnavailable
            } else if result.items.isEmpty {
                searchState = .noMatches
            } else {
                searchState = .results(result.items)
            }
        } catch {
            // A failed request is also "we could not ask", and saying "no such
            // address" here would send somebody rewriting a correct one.
            searchState = .providerUnavailable
        }
    }

    public func accept(_ candidate: AddressCandidate) {
        draft.accept(candidate)
        searchState = .idle
    }

    public func placePin(at position: Position) {
        draft.acceptPin(position)
    }

    // MARK: - North

    public func setRotation(_ degrees: Double) {
        draft.rotationDegrees = GeoreferenceDraft.normalizedRotation(degrees)
    }

    /// Offers the device's heading. Proposed, never applied: the map design
    /// requires heading to be evidence a person accepts, because a phone in a
    /// pocket near a fence produces confident nonsense.
    public func proposeDeviceHeading() async {
        proposedHeadingDegrees = await heading()
    }

    public func acceptProposedHeading() {
        guard let proposedHeadingDegrees else { return }
        setRotation(proposedHeadingDegrees)
        self.proposedHeadingDegrees = nil
    }

    // MARK: - Saving

    public func save() async -> Bool {
        guard draft.canSubmit else { return false }
        isSaving = true
        failureMessage = nil
        statusMessage = nil
        defer { isSaving = false }

        do {
            let saved = try await gateway.setGardenGeoreference(
                gardenId: gardenId,
                draft: draft,
                // `nil` asserts the garden has never been georeferenced, which
                // is a different claim from quoting a revision — the server
                // tells them apart, so this must not collapse them.
                expectedRevision: existing?.revision
            )
            existing = saved
            statusMessage = strings(.georeferenceSaved)
            return true
        } catch let error as APIGatewayError {
            failureMessage = message(for: error)
            return false
        } catch {
            failureMessage = strings(.georeferenceFailed)
            return false
        }
    }

    /// A revision disagreement has a real remedy and it is not "try again":
    /// somebody else moved the garden, and re-sending would overwrite them.
    private func message(for error: APIGatewayError) -> String {
        switch error {
        case .transport:
            strings(.georeferenceOffline)
        case let .service(_, status, _) where status == 409 || status == 412:
            strings(.georeferenceConflict)
        default:
            strings(.georeferenceFailed)
        }
    }
}
