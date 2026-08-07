import Foundation

public enum ExportScope: String, Sendable, Equatable, Codable {
    /// Everything the caller owns: their own personal data plus the full
    /// content of every garden they own alone.
    case account
    /// One garden, which requires owning it.
    case garden
}

public enum ExportRequestState: String, Sendable, Equatable, Codable {
    case requested
    case running
    case completed
    /// Generation concluded without a package. A failed export never exposes
    /// a partial object, so there is nothing to offer.
    case failed
}

/// One durable request to take a copy of your own data.
///
/// `docs/implementation-plan.md` section 26.1 lists export as **Required** on
/// both surfaces, and neither client had it. It is also the honest companion
/// to account deletion: "delete everything" is a far easier decision with
/// "download everything" beside it.
public struct ExportRequest: Sendable, Equatable {
    public let id: String
    public let scope: ExportScope
    public let gardenId: String?
    public let includeMedia: Bool
    public let state: ExportRequestState
    /// The consistency boundary. Every record in the package was read in one
    /// snapshot taken at this instant; anything after it is excluded and said
    /// so in the manifest.
    public let boundaryAt: Date?
    /// When the package stops being downloadable.
    public let expiresAt: Date?
    public let completedAt: Date?
    public let failureCode: String?
    public let createdAt: Date

    public init(
        id: String,
        scope: ExportScope,
        gardenId: String?,
        includeMedia: Bool,
        state: ExportRequestState,
        boundaryAt: Date?,
        expiresAt: Date?,
        completedAt: Date?,
        failureCode: String?,
        createdAt: Date
    ) {
        self.id = id
        self.scope = scope
        self.gardenId = gardenId
        self.includeMedia = includeMedia
        self.state = state
        self.boundaryAt = boundaryAt
        self.expiresAt = expiresAt
        self.completedAt = completedAt
        self.failureCode = failureCode
        self.createdAt = createdAt
    }

    /// Still working. The client polls while this is true.
    public var isInProgress: Bool { state == .requested || state == .running }
    public var isDownloadable: Bool { state == .completed }
}
