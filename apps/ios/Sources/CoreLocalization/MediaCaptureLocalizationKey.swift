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
}
