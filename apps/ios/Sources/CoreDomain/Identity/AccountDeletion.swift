import Foundation

/// How one garden was resolved by the account's deletion.
///
/// Shown to the person BEFORE the deadline rather than reported afterwards:
/// `data-export-and-deletion.md` section 11.1 resolves ownership inside the
/// request transaction precisely so somebody can see what happens to each
/// garden while they can still change their mind.
public enum AccountDeletionGardenResolution: String, Sendable, Equatable, Codable {
    /// The only owner. The garden enters its own deletion on the same
    /// deadline and purges with the account.
    case gardenDeletionRequested
    /// Another active owner remains. The garden survives; only this
    /// membership is revoked.
    case ownershipRetainedByCoOwner
    /// An editor or a viewer. The garden is untouched.
    case membershipRevoked
}

public struct AccountDeletionGarden: Sendable, Equatable, Codable {
    public let gardenId: String
    public let resolution: AccountDeletionGardenResolution

    public init(gardenId: String, resolution: AccountDeletionGardenResolution) {
        self.gardenId = gardenId
        self.resolution = resolution
    }
}

public enum AccountDeletionState: String, Sendable, Equatable, Codable {
    /// Pending and fully reversible until the deadline.
    case recoveryWindow
    /// The sweep has claimed the account; recovery is refused from here.
    case purging
}

/// A pending deletion of the caller's own account.
///
/// A status resource rather than a copy of what is being deleted — it carries
/// no personal data beyond identifiers the caller already holds.
public struct AccountDeletion: Sendable, Equatable, Codable {
    public let profileId: String
    public let state: AccountDeletionState
    public let requestedAt: Date
    /// When recovery stops being possible. Shown, not hidden: Apple accepts a
    /// disclosed grace period and rejects an undisclosed one.
    public let recoveryDeadlineAt: Date
    public let gardens: [AccountDeletionGarden]

    public init(
        profileId: String,
        state: AccountDeletionState,
        requestedAt: Date,
        recoveryDeadlineAt: Date,
        gardens: [AccountDeletionGarden]
    ) {
        self.profileId = profileId
        self.state = state
        self.requestedAt = requestedAt
        self.recoveryDeadlineAt = recoveryDeadlineAt
        self.gardens = gardens
    }

    public var isReversible: Bool { state == .recoveryWindow }
}
