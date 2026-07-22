/// The application's view of `POST /gardens/{gardenId}/map/commands`'s
/// response: the object or objects the command affected, at their new
/// revision.
///
/// Most commands affect exactly one object; `joinLinework` affects two (the
/// two source objects and/or the merged result, depending on how the server
/// models the merge) — a list rather than a single object either way, so the
/// map editor's command-submission path does not need a second response
/// shape once `joinLinework` is wired up.
///
/// Source: packages/api-contracts/openapi.yaml, `MapCommandResult`.
public struct MapCommandResult: Equatable, Sendable {
    public let affectedObjects: [GardenMapObject]

    public init(affectedObjects: [GardenMapObject]) {
        self.affectedObjects = affectedObjects
    }
}
