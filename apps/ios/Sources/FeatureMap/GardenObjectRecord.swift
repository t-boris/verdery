import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for the local map-object read model (`garden_object`).
///
/// Mirrors `FeatureGardens.GardenRecord`'s pattern exactly: originally would
/// have been a passive server-mirror cache, but since P5-IOS-02 (Stage 4b)
/// this table's whole reason to exist is durably holding the optimistic
/// local projection an offline map command commits — see
/// `LocalMapStore.commitOfflineMutation(gardenId:command:)`'s doc comment.
///
/// `geometry`/`categoryDetails` round-trip through `CoreDomain`'s own
/// domain-shaped `Codable` conformances (`GeometryCoding.swift`,
/// `GardenObjectDetailsCoding.swift`) — see
/// `LocalDatabase+MapObjectMigration.swift`'s doc comment for why those, not
/// normalized columns, and why the domain-shaped (nested `categoryDetails`)
/// conformance specifically, not `CoreNetworking.MapCommandWireCoding`'s flat
/// one: this is local-only storage with no wire contract of its own, exactly
/// the distinction `GardenObjectDetailsWireCoding`'s own doc comment draws.
struct GardenObjectRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "garden_object"

    let id: String
    let gardenId: String
    let category: String
    let geometry: String
    let coordinateSpaceId: String
    let label: String?
    let categoryDetails: String?
    let lifecycleState: String
    let revision: Int
    let createdAt: Date
    let updatedAt: Date
}

extension GardenObjectRecord {
    /// - Throws: only if `object.geometry`/`object.categoryDetails` cannot
    ///   be encoded to UTF-8 JSON — not expected in practice (see
    ///   `GardenCommandError.payloadEncodingFailed`'s identical reasoning for
    ///   the same near-impossible failure mode), but `JSONEncoder.encode` is
    ///   itself throwing, so this stays honest about it rather than forcing
    ///   the result.
    init(_ object: GardenMapObject) throws {
        self.id = object.id
        self.gardenId = object.gardenId
        self.category = object.category.rawValue
        self.geometry = try Self.encodeJSON(object.geometry)
        self.coordinateSpaceId = object.coordinateSpaceId
        self.label = object.label
        self.categoryDetails = try object.categoryDetails.map(Self.encodeJSON)
        self.lifecycleState = object.lifecycleState.rawValue
        self.revision = object.revision
        self.createdAt = object.createdAt
        self.updatedAt = object.updatedAt
    }

    /// `nil` when any stored column cannot be decoded back into its domain
    /// type — the same defensive-read posture `GardenRecord.domainValue`
    /// already establishes, so a caller's `compactMap` drops a corrupt row
    /// rather than failing the whole fetch.
    var domainValue: GardenMapObject? {
        guard
            let category = GardenObjectCategory(rawValue: category),
            let lifecycleState = ObjectLifecycleState(rawValue: lifecycleState),
            let geometry = try? Self.decodeJSON(geometry, as: Geometry.self)
        else {
            return nil
        }

        // A `categoryDetails` column present but undecodable is treated the
        // same as the whole row being corrupt (`nil`), not silently dropped
        // to `nil` details: unlike `JSONColumnCoding`'s local-bookkeeping
        // arrays, an object's category details are meaningful domain data a
        // caller must not silently lose.
        let categoryDetails: GardenObjectDetails?
        if let categoryDetailsText = self.categoryDetails {
            guard let decoded = try? Self.decodeJSON(categoryDetailsText, as: GardenObjectDetails.self) else {
                return nil
            }
            categoryDetails = decoded
        } else {
            categoryDetails = nil
        }

        return GardenMapObject(
            id: id,
            gardenId: gardenId,
            category: category,
            geometry: geometry,
            coordinateSpaceId: coordinateSpaceId,
            label: label,
            categoryDetails: categoryDetails,
            lifecycleState: lifecycleState,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    private static func encodeJSON(_ value: some Encodable) throws -> String {
        let data = try JSONEncoder().encode(value)
        guard let text = String(data: data, encoding: .utf8) else {
            throw MapCommandError.payloadEncodingFailed
        }
        return text
    }

    private static func decodeJSON<T: Decodable>(_ text: String, as type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: Data(text.utf8))
    }
}
