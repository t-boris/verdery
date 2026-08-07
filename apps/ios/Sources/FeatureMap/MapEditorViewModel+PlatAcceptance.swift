import CoreDomain
import Foundation

/// Turning what a reviewer ticked on a plat into ordinary map commands.
///
/// This is ADR-0018's separation expressed as code: the reading produced
/// proposals and touched nothing, and everything that reaches the garden goes
/// through the same `createObject` path a finger-drawn bed goes through —
/// same authorization, same revision guard, same audit trail, same offline
/// outbox. There is deliberately no shortcut that writes a proposal directly.
extension MapEditorViewModel {
    /// Applies an acceptance, one ordinary command per accepted shape.
    ///
    /// Sequential rather than concurrent: each command carries a revision and
    /// the local store is one writer, so a fan-out would only race itself. A
    /// plat's worth of shapes is a handful, not a migration.
    public func acceptPlatReading(_ acceptance: PlatReadingViewModel.Acceptance) async {
        if let boundary = acceptance.boundary {
            await submitPlatShape(
                category: .lot,
                geometry: boundary,
                // The boundary is the lot itself, and a plat does not name it.
                label: nil
            )
        }

        for object in acceptance.objects {
            guard let category = CreatableMapObjectCategory(rawValue: object.category.rawValue)
            else {
                // A category this editor cannot create is skipped rather than
                // coerced into another: drawing a proposed easement as a bed
                // would be worse than not drawing it.
                continue
            }
            await submitPlatShape(
                category: category,
                geometry: object.geometry,
                label: object.label.isEmpty ? nil : object.label
            )
        }

        // The document is re-read rather than patched: several commands landed,
        // each bumping a revision, and the editor's own copy is now behind.
        await load()
    }

    /// Applying accepted aerial proposals, through the same ordinary path.
    public func acceptAerialTracing(_ proposals: [AerialTracingProposal]) async {
        for proposal in proposals {
            guard let category = CreatableMapObjectCategory(rawValue: proposal.category.rawValue)
            else { continue }
            await submitPlatShape(
                category: category,
                geometry: proposal.geometry,
                label: proposal.label.isEmpty ? nil : proposal.label
            )
        }
        await load()
    }

    private func submitPlatShape(
        category: CreatableMapObjectCategory,
        geometry: Geometry,
        label: String?
    ) async {
        await submit(
            MapGestureCommands.createCommand(
                objectId: UUIDv7.generate(),
                category: category,
                geometry: geometry,
                label: label
            ),
            undoBeforeSnapshot: nil
        )
    }
}
