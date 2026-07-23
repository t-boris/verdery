import CoreDomain
import CoreNetworking

/// Classifies a genuine gateway-layer failure (never a per-item server
/// outcome — those are already the six push outcomes / two pull change
/// operations, handled directly) into `CoreDomain.SyncErrorCategory` — the
/// same classification `SyncErrorCategory`'s own doc comment already
/// anticipates ("Mirrors how `CoreNetworking.APIGatewayError` classifies a
/// single failed request") but that nothing built until this stage, since
/// `RemoteSyncEngine.pushPending()` (Stage 5a) let any thrown
/// `APIGatewayError` propagate uncaught rather than durably recording it.
///
/// Lives in `CoreSynchronization`, not `CoreNetworking`: only synchronization
/// code needs `CoreDomain.SyncErrorCategory` at all — `CoreNetworking`'s own
/// error type stays unaware of a classification vocabulary the rest of the
/// networking layer (health checks, garden/plant/task/observation/map
/// gateways) has no use for.
extension APIGatewayError {
    var syncErrorCategory: SyncErrorCategory {
        switch self {
        case .transport:
            .connectivity
        case let .service(body, _, _):
            switch body.sharedCode {
            case .unauthenticated: .authentication
            case .forbidden: .authorization
            case .requestInvalid, .requestTooLarge, .idempotencyKeyReused: .validation
            case .staleRevision: .conflict
            case .rateLimited, .dependencyUnavailable, .internalFailure: .server
            case nil:
                // A module-specific code this shared enum does not name —
                // `sync.changes.cursor_expired`/`sync.protocol_version
                // .unsupported` land here too; both are handled as their own
                // explicit full-resync path before this classification is
                // ever consulted (see `RemoteSyncEngine+Pull.swift`), so by
                // the time a `.service` failure reaches this default it is
                // genuinely unclassified, not merely unmapped.
                .server
            }
        case .undecodableResponse, .unexpectedStatus:
            // A contract violation, not something the user or a retry can
            // fix — `SyncErrorCategory` has no dedicated case for "the
            // response did not match the contract", and `.unknown` is
            // exactly that vocabulary's own catch-all.
            .unknown
        }
    }
}
