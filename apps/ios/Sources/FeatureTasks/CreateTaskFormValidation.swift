import CoreDomain

/// Pure validation for the "Create a task" form, kept free of the view model
/// so it is testable without a gateway or a running view model.
///
/// Mirrors the migration's `task_target_consistency_check`, restated in
/// `CreateManualTaskRequest`'s own description: `kind: garden` sets neither
/// id; `kind: garden_area` sets only `gardenAreaMapObjectId`; `kind: plant`
/// sets only `plantId`.
///
/// Source: packages/api-contracts/openapi.yaml, `CreateManualTaskRequest`.
public enum CreateTaskFormValidation {
    public enum Failure: Error, Equatable, Sendable {
        case titleRequired
        case targetIdRequired
    }

    public static func resolve(
        title: String,
        targetKind: TaskTargetKind,
        targetGardenAreaMapObjectId: String,
        targetPlantId: String
    ) -> Result<(title: String, gardenAreaMapObjectId: String?, plantId: String?), Failure> {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else { return .failure(.titleRequired) }

        switch targetKind {
        case .garden:
            return .success((trimmedTitle, nil, nil))

        case .gardenArea:
            let trimmedId = targetGardenAreaMapObjectId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedId.isEmpty else { return .failure(.targetIdRequired) }
            return .success((trimmedTitle, trimmedId, nil))

        case .plant:
            let trimmedId = targetPlantId.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedId.isEmpty else { return .failure(.targetIdRequired) }
            return .success((trimmedTitle, nil, trimmedId))
        }
    }
}
