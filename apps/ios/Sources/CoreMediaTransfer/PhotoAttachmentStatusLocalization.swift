import CoreLocalization
import Foundation

/// Shared, localized rendering of `PhotoAttachmentStatus` — one mapping,
/// used by both `FeaturePlants.PlantDetailView`'s and `FeatureObservations
/// .ObservationsTimelineView`'s own "Attach Photo" affordance, rather than
/// each independently writing the same switch-to-string copy twice.
///
/// Deliberately generic, not the raw `reasonCode`: every other error-message
/// mapping in this codebase (`PlantDetailViewModel.message(for:
/// APIGatewayError)`, `ObservationsTimelineViewModel`'s identical method)
/// already shows a small, stable set of user-facing categories rather than a
/// raw internal code — this follows the same convention.
public enum PhotoAttachmentStatusLocalization {
    public static func text(for status: PhotoAttachmentStatus, strings: LocalizedStrings) -> String {
        switch status {
        case .idle:
            ""
        case .preparing:
            strings(.mediaStatusPreparing)
        case .waitingForConnectivity:
            strings(.mediaStatusWaitingForConnectivity)
        case let .uploading(progressFraction):
            strings.string(.mediaStatusUploadingPercent, parameters: ["percent": String(Int((progressFraction * 100).rounded()))])
        case .verifying:
            strings(.mediaStatusVerifying)
        case .processing:
            strings(.mediaStatusProcessing)
        case .ready:
            strings(.mediaStatusReady)
        case .rejected:
            strings(.mediaStatusRejected)
        case .failed:
            strings(.mediaStatusFailed)
        }
    }
}
