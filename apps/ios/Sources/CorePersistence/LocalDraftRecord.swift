import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for `local_draft`.
///
/// Source: architecture/ios-application-design.md, section "7. Local
/// Persistence".
struct LocalDraftRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "local_draft"

    let id: String
    let profileId: String
    let gardenId: String?
    let draftType: String
    let schemaVersion: Int
    let payload: String
    let createdAt: Date
    let updatedAt: Date
}

extension LocalDraftRecord {
    init(_ draft: LocalDraft) {
        self.id = draft.id
        self.profileId = draft.profileId
        self.gardenId = draft.gardenId
        self.draftType = draft.draftType
        self.schemaVersion = draft.schemaVersion
        self.payload = draft.payload
        self.createdAt = draft.createdAt
        self.updatedAt = draft.updatedAt
    }

    var domainValue: LocalDraft {
        LocalDraft(
            id: id,
            profileId: profileId,
            gardenId: gardenId,
            draftType: draftType,
            schemaVersion: schemaVersion,
            payload: payload,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}
