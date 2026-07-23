import Foundation

/// A file attached to a task.
///
/// Uploading the underlying file is out of scope this pass — see
/// `FeatureTasks`'s doc comment on `AttachTaskFile` for the honest gap this
/// leaves — but the shape is modelled fully so the gateway method and its
/// tests are contract-accurate regardless.
///
/// Source: packages/api-contracts/openapi.yaml, `TaskAttachment`.
public struct TaskAttachment: Equatable, Sendable, Identifiable {
    public let id: String
    public let taskId: String
    public let mediaId: String
    public let createdAt: Date

    public init(id: String, taskId: String, mediaId: String, createdAt: Date) {
        self.id = id
        self.taskId = taskId
        self.mediaId = mediaId
        self.createdAt = createdAt
    }
}
