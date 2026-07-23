import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for the local, offline-pending observation read model
/// (`observation`).
///
/// Unlike `FeatureGardens.GardenRecord`/`FeatureMap.GardenObjectRecord`/
/// `FeaturePlants.PlantRecord` — durable mirrors of a mutable current
/// record, upserted by every successful offline command AND by an online
/// read (`GetGarden`/`LoadGardenMap`/`GetPlant`) — this table holds only
/// rows this device appended itself, purely offline, via
/// `RecordObservation`/`CorrectObservation`. `ObservationsTimelineViewModel`
/// stays what its own doc comment already calls "always fresh from the
/// server" for every server-confirmed row: `ListObservationsForGarden`/
/// `ListObservationsForPlant` never write here. This table exists solely so
/// an offline-recorded entry can be shown immediately, merged alongside
/// whatever the next successful network fetch returns — see
/// `ObservationsTimelineViewModel.load()`.
///
/// A narrower field set than `GardenObservation`'s own, unlike
/// `PlantRecord`'s "same as the full domain type" reasoning: every offline
/// command here is a full, from-scratch insert (`RecordObservation`,
/// `CorrectObservation`) with everything already known at write time — there
/// is no `UpdateX`-style command here that leaves some fields untouched and
/// so needs them preserved from a prior row (`GardenObservation` has no
/// update path at all — see that type's own doc comment). `actorType`
/// (always `.user` for anything this client creates — only the server ever
/// produces a `.system` row), `createdByProfileId`, and `photos` (always
/// `[]` — no photo-attachment flow yet, see `ObservationsUseCases.swift`)
/// are therefore reconstructed as constants in `domainValue`, not stored
/// columns. `isCorrected` is not stored at all: it is not a property of one
/// row in isolation, but a fact about whether some OTHER row (local or
/// server-fetched) points back to it — recomputed at merge time in
/// `ObservationsTimelineViewModel`, never written back here (an append-only
/// table never has a row to write it back to).
///
/// Source: architecture/offline-synchronization.md, section "5. Local
/// Tables"; implementation-plan.md work package P5-IOS-02.
struct ObservationRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "observation"

    let id: String
    let gardenId: String
    let plantId: String?
    let gardenObjectId: String?
    let noteText: String?
    let conditionSummary: String?
    let correctionKind: String?
    let correctsObservationId: String?
    let observedAt: Date
    let recordedAt: Date
}

extension ObservationRecord {
    init(_ observation: GardenObservation) {
        self.id = observation.id
        self.gardenId = observation.gardenId
        self.plantId = observation.plantId
        self.gardenObjectId = observation.gardenObjectId
        self.noteText = observation.noteText
        self.conditionSummary = observation.conditionSummary
        self.correctionKind = observation.correctionKind?.rawValue
        self.correctsObservationId = observation.correctsObservationId
        self.observedAt = observation.observedAt
        self.recordedAt = observation.recordedAt
    }

    /// `nil` when `correctionKind` is present but not decodable — the same
    /// defensive-read posture `GardenRecord.domainValue`/`PlantRecord
    /// .domainValue` already establish, so a caller's `compactMap` drops a
    /// corrupt row rather than failing the whole read.
    ///
    /// `actorType: .user`, `createdByProfileId: nil`, `isCorrected: false`,
    /// `photos: []` are reconstructed constants, not decoded columns — see
    /// this type's own doc comment for why. `isCorrected: false` here is not
    /// a claim about the row's actual state — `ObservationsTimelineViewModel`
    /// recomputes it correctly at merge time from the full merged set, the
    /// same way it must for a server-fetched row whose `isCorrected` the
    /// server itself cannot yet know is stale.
    var domainValue: GardenObservation? {
        let resolvedCorrectionKind: ObservationCorrectionKind?
        if let correctionKind {
            guard let decoded = ObservationCorrectionKind(rawValue: correctionKind) else { return nil }
            resolvedCorrectionKind = decoded
        } else {
            resolvedCorrectionKind = nil
        }

        return GardenObservation(
            id: id,
            gardenId: gardenId,
            plantId: plantId,
            gardenObjectId: gardenObjectId,
            actorType: .user,
            createdByProfileId: nil,
            noteText: noteText,
            conditionSummary: conditionSummary,
            correctionKind: resolvedCorrectionKind,
            correctsObservationId: correctsObservationId,
            isCorrected: false,
            observedAt: observedAt,
            recordedAt: recordedAt,
            photos: []
        )
    }
}
