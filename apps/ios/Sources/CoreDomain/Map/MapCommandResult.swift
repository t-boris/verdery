/// The application's view of `POST /gardens/{gardenId}/map/commands`'s
/// response: the object or objects the command affected, at their new
/// revision.
///
/// Most commands affect exactly one object; `splitLinework`/`joinLinework`
/// each affect three — the soft-deleted source object(s) *and* the new
/// piece(s), confirmed directly against the backend's own handlers
/// (`services/api/.../application/split-map-object-linework.ts`,
/// `join-map-object-linework.ts`: both return `affectedObjects: [deleted...,
/// new...]`) during P5-IOS-02 (Stage 4b), which is what
/// `FeatureMap.MapCommandProjection` mirrors for the offline path — a list
/// rather than a single object either way, so the map editor's
/// command-submission path does not need a second response shape.
///
/// Source: packages/api-contracts/openapi.yaml, `MapCommandResult`.
public struct MapCommandResult: Equatable, Sendable {
    public let affectedObjects: [GardenMapObject]

    public init(affectedObjects: [GardenMapObject]) {
        self.affectedObjects = affectedObjects
    }
}
