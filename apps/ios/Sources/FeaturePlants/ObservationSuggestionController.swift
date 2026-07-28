import CoreLocalization
import CoreNetworking
import Observation

/// Drives "Record as observation" — the action `RecordObservationFromIdentification`
/// backs, independent of and combinable with confirming the same
/// identification's species suggestion (ADR-0015's own "AddPlantFromPhoto
/// suggests an observation too" extension).
///
/// A standalone controller, not a method on `PlantDetailViewModel`/
/// `PlantAddFromPhotoViewModel` directly, because both screens need the exact
/// same behavior against an identification's `id` — the same "one small
/// `@Observable` controller, shared" shape `PhotoAttachmentController`
/// already establishes for the upload flow both `PlantDetailViewModel` and
/// `ObservationsTimelineViewModel` hold one of.
@MainActor
@Observable
public final class ObservationSuggestionController {
    public private(set) var isRecording = false
    public private(set) var recordedConfirmation = false
    public private(set) var errorMessage: String?

    private let recordObservationFromIdentification: RecordObservationFromIdentification
    private let strings: LocalizedStrings

    public init(recordObservationFromIdentification: RecordObservationFromIdentification, strings: LocalizedStrings) {
        self.recordObservationFromIdentification = recordObservationFromIdentification
        self.strings = strings
    }

    public func record(gardenId: String, plantId: String, identificationId: String) async {
        isRecording = true
        errorMessage = nil
        defer { isRecording = false }

        do {
            _ = try await recordObservationFromIdentification(
                gardenId: gardenId, plantId: plantId, identificationId: identificationId
            )
            recordedConfirmation = true
        } catch let error as APIGatewayError {
            errorMessage = message(for: error)
        } catch {
            errorMessage = strings(.serverUnexpected)
        }
    }

    private func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }
}
