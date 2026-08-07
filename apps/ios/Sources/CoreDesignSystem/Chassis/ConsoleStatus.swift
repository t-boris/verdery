import SwiftUI

/// What the console's status strip is currently reporting.
///
/// A plain value with no domain knowledge — the label arrives already
/// localized and the count already computed — because ``CoreDesignSystem``
/// depends on nothing, not even `CoreDomain`. The mapping from a sync engine's
/// own vocabulary to this shape lives in the composition layer, where it is a
/// pure function and therefore assertable without rendering anything.
///
/// This is the missing consumer for a status the application has been
/// computing and discarding: `CoreSynchronization.SyncEngineStatus` names six
/// states that `architecture/ios-application-design.md` section 8 requires the
/// interface to distinguish, and until now no view read any of them.
public struct ConsoleStatus: Sendable, Equatable {
    /// How much attention the current state deserves.
    ///
    /// Deliberately coarser than the engine's own enum: a person standing in a
    /// garden needs to know whether their work is safe, moving, or stuck — not
    /// which of two failure classifications produced the stall.
    public enum Level: Sendable, Equatable, CaseIterable {
        /// Everything the device has is on the server.
        case settled
        /// A push or pull is in flight.
        case working
        /// Work is saved on the device and waiting its turn.
        case pending
        /// Saved on the device, and the network is not currently reachable.
        case offline
        /// Something needs a person: a conflict, or a failure retrying cannot
        /// clear on its own.
        case attention
    }

    public let label: String
    public let level: Level
    /// Operations still queued in the outbox, when that number is meaningful.
    public let count: Int?

    public init(label: String, level: Level, count: Int? = nil) {
        self.label = label
        self.level = level
        self.count = count
    }

    /// Only `attention` is worth interrupting someone for, so only it opens
    /// anything. Every other state is a report, and a report that can be
    /// tapped invites tapping it.
    public var isActionable: Bool { level == .attention }
}

extension ConsoleStatus.Level {
    /// The tone this level wears on the chassis.
    ///
    /// `pending` and `offline` are deliberately not warnings. Work saved on
    /// the device is the product working as designed — this application is
    /// offline-authoritative — and colouring the ordinary case amber would
    /// teach people to ignore the one state that matters.
    public var tone: Tone {
        switch self {
        case .settled: .positive
        case .working, .pending, .offline: .neutral
        case .attention: .negative
        }
    }

    /// A distinct silhouette per level, so the strip is readable without
    /// colour — it is 24 points tall and often seen in sunlight.
    public var symbol: String {
        switch self {
        case .settled: "checkmark.icloud.fill"
        case .working: "arrow.triangle.2.circlepath"
        case .pending: "clock.arrow.trianglehead.counterclockwise.rotate.90"
        case .offline: "bolt.horizontal.icloud"
        case .attention: "exclamationmark.icloud.fill"
        }
    }
}
