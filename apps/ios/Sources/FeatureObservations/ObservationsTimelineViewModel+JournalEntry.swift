import CoreDomain
import CoreLocalization
import Foundation

/// The record sheet's journal-entry inputs: the shot purpose a photograph is
/// labelled with, the symptoms the observer reports, and the measurements they
/// took (P11-MEDIA-01).
///
/// An extension in its own file rather than more lines in
/// `ObservationsTimelineViewModel.swift`, which reached this repository's
/// 600-line limit as this phase's journal work landed — the same split
/// `CollaborationGateway+OwnershipAdministration.swift` already makes for the
/// same reason.
///
/// Symptoms and measurements share one rule: at most one row per kind, because
/// `observation_symptom_unique_kind` and `observation_measurement_unique_kind`
/// each permit exactly that. A rule the server enforces should not first reach
/// the observer as a refusal.
extension ObservationsTimelineViewModel {
    public var symptomsLegend: String { strings(.observationsSymptomsLegend) }
    /// The timeline's own label for the observer's symptoms — the counterpart to the web entry's `observations.symptomsReported`.
    public var symptomsReportedLabel: String { strings(.observationsSymptomsReported) }
    public var symptomKindLabel: String { strings(.observationsSymptomKindLabel) }
    public var symptomSeverityLabel: String { strings(.observationsSymptomSeverityLabel) }
    public var symptomAddTitle: String { strings(.observationsSymptomAdd) }
    public var symptomRemoveTitle: String { strings(.observationsSymptomRemove) }

    public func symptomKindName(_ kind: ObservationSymptomKind) -> String {
        ObservationsLocalization.symptomKindName(kind, strings: strings)
    }

    public func symptomSeverityName(_ severity: ObservationSymptomSeverity) -> String {
        ObservationsLocalization.symptomSeverityName(severity, strings: strings)
    }

    /// The kinds a given row may switch to: its own, plus any no other row holds.
    public func availableSymptomKinds(for symptom: ObservationSymptomInput) -> [ObservationSymptomKind] {
        let taken = Set(recordSymptoms.map(\.kind))
        return ObservationSymptomKind.allCases.filter { $0 == symptom.kind || !taken.contains($0) }
    }

    public var nextFreeSymptomKind: ObservationSymptomKind? {
        let taken = Set(recordSymptoms.map(\.kind))
        return ObservationSymptomKind.allCases.first { !taken.contains($0) }
    }

    public func addSymptom() {
        guard let kind = nextFreeSymptomKind else { return }
        recordSymptoms.append(ObservationSymptomInput(kind: kind, severity: .mild))
    }

    public func removeSymptom(_ kind: ObservationSymptomKind) {
        recordSymptoms.removeAll { $0.kind == kind }
    }

    public func measurementKindName(_ kind: ObservationMeasurementKind) -> String {
        ObservationsLocalization.measurementKindName(kind, strings: strings)
    }

    /// The kinds a given row may switch to: its own, plus any no other row
    /// holds.
    public func availableMeasurementKinds(
        for measurement: ObservationMeasurementInput
    ) -> [ObservationMeasurementKind] {
        let taken = Set(recordMeasurements.map(\.kind))
        return ObservationMeasurementKind.allCases.filter {
            $0 == measurement.kind || !taken.contains($0)
        }
    }

    /// The kind a new row would take, or `nil` when every kind is in use —
    /// which is what hides the add control.
    public var nextFreeMeasurementKind: ObservationMeasurementKind? {
        let taken = Set(recordMeasurements.map(\.kind))
        return ObservationMeasurementKind.allCases.first { !taken.contains($0) }
    }

    public func addMeasurement() {
        guard let kind = nextFreeMeasurementKind else { return }
        // Centimetres because that is what a plant is measured in; every part
        // of the row stays editable, and the unit is a free string on the
        // contract, so nothing here fixes a vocabulary.
        recordMeasurements.append(ObservationMeasurementInput(kind: kind, value: 0, unit: "cm"))
    }

    public func removeMeasurement(_ kind: ObservationMeasurementKind) {
        recordMeasurements.removeAll { $0.kind == kind }
    }
    /// Whether the record form's submit action should be disabled: a photo
    /// pick is in progress but not yet `.ready` — submitting now would
    /// either drop the picked photo silently or (if an attachment could
    /// somehow reference a not-yet-confirmed upload) violate the invariant
    /// this file's own doc comment on `RecordObservation`'s `photos`
    /// establishes. Not blocked by `.idle` (no photo picked at all — the
    /// contract's own "note and/or condition alone is valid" stays true) or
    /// by `.ready`/a terminal failure (the user can still submit without
    /// the photo, or after removing it).
    public var isPhotoBlockingSubmit: Bool {
        guard let status = photoAttachment?.status else { return false }
        switch status {
        case .idle, .ready, .rejected, .failed:
            return false
        case .preparing, .waitingForConnectivity, .uploading, .verifying, .processing:
            return true
        }
    }
}
