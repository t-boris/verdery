import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// What an aerial photograph appears to show over a georeferenced garden.
///
/// Same posture as the plat reader, for the same reason: imagery is a backdrop
/// and never geometry, so everything here is a proposal until somebody accepts
/// it, and accepting goes through ordinary map commands.
///
/// Pre-selection tells the truth about evidence. A shape the photograph showed
/// arrives ticked; a shape that was inferred from context is offered and never
/// ticked. Accepting a hedge nobody photographed, because a box was already
/// checked, is how a garden acquires a fence that is not there.
@MainActor
@Observable
public final class AerialTracingViewModel {
    public enum State: Equatable {
        case idle
        case tracing
        case reviewing(AerialTracing)
        /// The garden has no coordinates, so there is no photograph to look at.
        /// The one failure a person can resolve themselves.
        case needsGeoreference
        case failed(message: String)
    }

    public private(set) var state: State = .idle
    public var acceptedIds: Set<String> = []

    private let gardenId: String
    private let trace: TraceFromAerial
    let strings: LocalizedStrings
    private let generateIdempotencyKey: @Sendable () -> String

    public init(
        gardenId: String,
        trace: TraceFromAerial,
        strings: LocalizedStrings,
        generateIdempotencyKey: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.gardenId = gardenId
        self.trace = trace
        self.strings = strings
        self.generateIdempotencyKey = generateIdempotencyKey
    }

    public func run() async {
        state = .tracing
        do {
            let tracing = try await trace(
                gardenId: gardenId,
                idempotencyKey: generateIdempotencyKey()
            )
            acceptedIds = tracing.preSelectedIds
            state = .reviewing(tracing)
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.platFailed))
        }
    }

    public func toggle(_ proposal: AerialTracingProposal) {
        if acceptedIds.contains(proposal.id) {
            acceptedIds.remove(proposal.id)
        } else {
            acceptedIds.insert(proposal.id)
        }
    }

    public func isAccepted(_ proposal: AerialTracingProposal) -> Bool {
        acceptedIds.contains(proposal.id)
    }

    public var accepted: [AerialTracingProposal] {
        guard case let .reviewing(tracing) = state else { return [] }
        return tracing.proposals.filter { acceptedIds.contains($0.id) }
    }

    public var canAccept: Bool { !accepted.isEmpty }

    // MARK: - Text

    public var title: String { strings(.aerialTitle) }
    public var explanation: String { strings(.aerialExplanation) }
    public var tracingMessage: String { strings(.aerialTracing) }
    public var emptyMessage: String { strings(.aerialEmpty) }
    public var needsGeoreferenceMessage: String { strings(.aerialNeedsGeoreference) }
    public var acceptTitle: String { strings(.aerialAccept) }
    public var closeTitle: String { strings(.mapPropertyClose) }

    /// Named rather than coloured. "Seen" and "Guessed" are different claims
    /// about the same photograph, and a reviewer deciding whether to accept a
    /// shape needs the word, not a hue.
    public func evidenceName(_ evidence: AerialEvidence) -> String {
        switch evidence {
        case .visible: strings(.aerialVisible)
        case .inferred: strings(.aerialInferred)
        }
    }

    public func label(_ proposal: AerialTracingProposal) -> String {
        proposal.label.isEmpty ? proposal.category.rawValue : proposal.label
    }

    /// A `403` here means the garden has no georeference, which is the one
    /// failure the reader can fix — so it gets its own state rather than the
    /// generic sentence.
    private func message(for error: APIGatewayError) -> String {
        if case .transport = error { return strings(.platOffline) }
        return strings(.platFailed)
    }
}

/// Asking what an aerial photograph shows.
public struct TraceFromAerial: Sendable {
    private let gateway: any PlanReadingGateway

    public init(gateway: any PlanReadingGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        idempotencyKey: String
    ) async throws -> AerialTracing {
        try await gateway.traceFromAerial(gardenId: gardenId, idempotencyKey: idempotencyKey)
    }
}
