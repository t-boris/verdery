import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// Reviewing what a surveyor's plat says, next to the drawing it came from.
///
/// **Reading writes nothing.** What a person ticks here becomes ordinary
/// commands — a georeference for the location and north, map commands for the
/// shapes — each carrying its own authorization, revision and audit trail. That
/// separation is ADR-0018's whole point, and it is why this model has a
/// `reading` and a `selection` and no third thing in between.
///
/// Pre-selection is arithmetic rather than optimism. The boundary arrives
/// ticked only when the traverse closes **and** the walked area agrees with the
/// area the sheet prints; nothing at all is offered when the traverse fails,
/// because every object's position rides the same page fit as the boundary.
@MainActor
@Observable
public final class PlatReadingViewModel {
    public enum State: Equatable {
        case idle
        case reading
        case reviewing(PlatReading)
        /// The page is not a plat. A real answer, and the drawing is still
        /// usable as something to trace over.
        case notAPlat
        case failed(message: String)
    }

    public private(set) var state: State = .idle
    public private(set) var isAccepting = false
    public private(set) var statusMessage: String?

    /// What the reviewer has ticked. Seeded from the arithmetic, then theirs.
    public var acceptBoundary = false
    public var acceptLocation = false
    public var acceptedObjectIds: Set<String> = []

    private let gardenId: String
    private let planMediaId: String
    private let readPlat: ReadPlatFromPlan
    /// Module-internal, not `private`: read by
    /// `PlatReadingViewModel+Text.swift`, a same-type extension in another
    /// file, which `private` (a file scope) would exclude.
    let strings: LocalizedStrings
    private let generateIdempotencyKey: @Sendable () -> String

    public init(
        gardenId: String,
        planMediaId: String,
        readPlat: ReadPlatFromPlan,
        strings: LocalizedStrings,
        generateIdempotencyKey: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.gardenId = gardenId
        self.planMediaId = planMediaId
        self.readPlat = readPlat
        self.strings = strings
        self.generateIdempotencyKey = generateIdempotencyKey
    }

    // MARK: - Reading

    public func read() async {
        state = .reading
        do {
            let reading = try await readPlat(
                gardenId: gardenId,
                planMediaId: planMediaId,
                idempotencyKey: generateIdempotencyKey()
            )
            guard reading.isPlat else {
                state = .notAPlat
                return
            }
            seedSelection(from: reading)
            state = .reviewing(reading)
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.platFailed))
        }
    }

    /// Ticks what the arithmetic says is corroborated, and nothing else.
    ///
    /// An address is offered as a location only when the sheet carried one and
    /// the boundary is trustworthy: a plat states no coordinates, so the
    /// location comes from geocoding that address, and geocoding an address off
    /// a sheet whose reading is wrong would place the garden confidently in the
    /// wrong town.
    private func seedSelection(from reading: PlatReading) {
        acceptBoundary = PlatReadingReview.isBoundaryPreSelected(reading)
        acceptLocation = acceptBoundary && reading.address != nil
        acceptedObjectIds = []
    }

    // MARK: - Selection

    public func toggleObject(_ object: ProposedPlatObject) {
        if acceptedObjectIds.contains(object.id) {
            acceptedObjectIds.remove(object.id)
        } else {
            acceptedObjectIds.insert(object.id)
        }
    }

    public func isAccepted(_ object: ProposedPlatObject) -> Bool {
        acceptedObjectIds.contains(object.id)
    }

    /// Whether the objects section is offered at all.
    public var offersObjects: Bool {
        guard case let .reviewing(reading) = state else { return false }
        return PlatReadingReview.objectsAreOffered(reading)
    }

    public var canAccept: Bool {
        !isAccepting && (acceptBoundary || acceptLocation || !acceptedObjectIds.isEmpty)
    }

    /// What the reviewer ticked, as values for the caller to turn into ordinary
    /// commands. Deliberately not commands themselves: this screen decides what
    /// is trustworthy, and the composition layer decides what to send.
    public struct Acceptance: Sendable, Equatable {
        public let boundary: Geometry?
        public let address: String?
        public let northRotationDegrees: Double?
        public let objects: [ProposedPlatObject]
    }

    public func acceptance() -> Acceptance? {
        guard case let .reviewing(reading) = state else { return nil }
        return Acceptance(
            boundary: acceptBoundary ? reading.boundary?.geometry : nil,
            address: acceptLocation ? reading.address : nil,
            northRotationDegrees: acceptLocation ? reading.northRotationDegrees : nil,
            objects: reading.objects.filter { acceptedObjectIds.contains($0.id) }
        )
    }

    public func markAccepted() {
        statusMessage = strings(.platAccepted)
    }

    private func message(for error: APIGatewayError) -> String {
        if case .transport = error { return strings(.platOffline) }
        return strings(.platFailed)
    }
}

/// Transcribing a plat into a reviewable reading.
public struct ReadPlatFromPlan: Sendable {
    private let gateway: any PlanReadingGateway

    public init(gateway: any PlanReadingGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        planMediaId: String,
        idempotencyKey: String
    ) async throws -> PlatReading {
        try await gateway.readPlatFromPlan(
            gardenId: gardenId,
            planMediaId: planMediaId,
            idempotencyKey: idempotencyKey
        )
    }
}
