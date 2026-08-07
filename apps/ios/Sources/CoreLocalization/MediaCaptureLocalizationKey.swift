/// Keys the live camera-capture affordance resolves against the localization
/// catalogue — shared across every photo-attach point
/// (`CoreMediaTransfer.CameraCapturePicker`).
///
/// A second enum for this key set rather than more cases in
/// ``LocalizationKey`` — the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum MediaCaptureLocalizationKey: String, Sendable, CaseIterable {
    case mediaCaptureTakePhotoButton = "media.capture.takePhotoButton"
    case mediaCapturePermissionDeniedMessage = "media.capture.permissionDenied"
    case mediaCaptureOpenSettingsButton = "media.capture.openSettingsButton"

    /// Scanning a paper drawing with the phone. Its own entry rather than a
    /// reuse of "take a photo": the scanner finds the page edges and corrects
    /// the perspective, which is a different promise from a photograph.
    case mediaPlanScanDocument = "media.plan.scanDocument"
    case mediaPlanScanHint = "media.plan.scanHint"

    /// A plan whose derivative has not arrived yet. Deliberately not the same
    /// sentence as "no preview is available": one resolves on its own and the
    /// other never will, and saying the wrong one sends somebody re-uploading a
    /// file that was fine.
    case mediaPlanPreviewProcessing = "media.plan.previewProcessing"
}
