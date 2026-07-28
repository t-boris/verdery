import SwiftUI

/// Whether this device can present a live camera capture at all, and — when
/// it can — whether this app is currently allowed to use it.
///
/// A narrow addition, not the `Core/PlatformCapabilities`+`Features/
/// GardenCapture` AVFoundation capture-session architecture `architecture/
/// ios-application-design.md` section "12. Capture Architecture" describes
/// for a future garden-geometry capture flow (Phase 11): this is "take one
/// photo, hand it to `PhotoAttachmentController` the same way a
/// `PhotosPicker` selection already is," not a owned capture session.
public enum CameraCaptureAuthorization: Sendable {
    case authorized
    case notDetermined
    case denied
}

#if os(iOS)
import AVFoundation
import UIKit

public enum CameraCapture {
    /// `false` on the Simulator and on any device with no camera — the same
    /// "no control that could only fail" posture `PlantAddFromPhotoSheetView`
    /// already takes for a `PlantAddFromPhotoViewModel` built with no
    /// `photoAttachment`.
    public static var isAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    /// Read-only: never itself triggers the system permission prompt. That
    /// prompt fires the first time `CameraCapturePicker` is actually
    /// presented while the status is `.notDetermined` — this is only for
    /// deciding whether to show the "permission denied, open Settings"
    /// message INSTEAD of presenting a picker that would otherwise silently
    /// show nothing.
    public static var authorizationStatus: CameraCaptureAuthorization {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized, .notDetermined:
            // `.notDetermined` is deliberately grouped with `.authorized`,
            // not `.denied`: the system prompt has not been shown yet, so
            // this is not a denial to react to — presenting the picker is
            // what asks the question.
            .notDetermined
        case .restricted, .denied:
            .denied
        @unknown default:
            .denied
        }
    }

    /// Opens this app's own Settings page — the only recourse once the
    /// system has already recorded a denial, since presenting the picker
    /// again would not re-ask. Kept here, not in a feature view, so a
    /// feature file never needs its own `import UIKit` just for this one
    /// call — `PhotosUI`/`SwiftUI` alone (both cross-platform) are enough
    /// for everything else those files do.
    @MainActor
    public static func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

/// A single photo, straight from the device's own camera — the real system
/// camera UI (`UIImagePickerController(sourceType: .camera)`), not a custom
/// AVFoundation session: this app only ever needs one still photo per call,
/// which is exactly what Apple's own camera screen already provides.
///
/// `onCapture` receives the photo already encoded as JPEG `Data` plus its
/// MIME type, the same shape `PhotoAttachmentController.attach(data
/// :displayFilename:contentType:)` already takes from a `PhotosPicker`
/// selection — every call site converts a captured photo through the
/// identical, one-tested path a library selection already uses.
public struct CameraCapturePicker: UIViewControllerRepresentable {
    private let onCapture: (Data, String) -> Void
    @Environment(\.dismiss) private var dismiss

    public init(onCapture: @escaping (Data, String) -> Void) {
        self.onCapture = onCapture
    }

    public func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    public func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    public func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture, dismiss: dismiss)
    }

    public final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onCapture: (Data, String) -> Void
        private let dismiss: DismissAction

        init(onCapture: @escaping (Data, String) -> Void, dismiss: DismissAction) {
            self.onCapture = onCapture
            self.dismiss = dismiss
        }

        public func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            defer { dismiss() }
            guard let image = info[.originalImage] as? UIImage,
                let data = image.jpegData(compressionQuality: 0.9)
            else { return }
            onCapture(data, "image/jpeg")
        }

        public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}
#else
// This branch exists only so the package still builds for macOS (`swift
// build`/`swift test` on a developer machine and in CI — see
// `apps/ios/README.md`'s "Build and test" section) — `UIImagePickerController`
// is iOS-only. Never compiled into the shipped iOS app.
public enum CameraCapture {
    public static var isAvailable: Bool { false }
    public static var authorizationStatus: CameraCaptureAuthorization { .denied }
    @MainActor
    public static func openSettings() {}
}

public struct CameraCapturePicker: View {
    private let onCapture: (Data, String) -> Void

    public init(onCapture: @escaping (Data, String) -> Void) {
        self.onCapture = onCapture
    }

    public var body: some View { EmptyView() }
}
#endif

extension View {
    /// Presents `CameraCapturePicker` full-screen when `isPresented` is
    /// `true` — the one call every photo-attach screen needs, with the
    /// `#if os(iOS)` this requires (`fullScreenCover` does not exist on
    /// macOS at all, unlike `CameraCapturePicker` itself, which at least
    /// compiles everywhere as an inert stub) kept in this one shared place
    /// rather than repeated at each of the three call sites.
    @ViewBuilder
    public func cameraCapture(
        isPresented: Binding<Bool>,
        onCapture: @escaping (Data, String) -> Void
    ) -> some View {
        #if os(iOS)
        fullScreenCover(isPresented: isPresented) {
            CameraCapturePicker(onCapture: onCapture)
                .ignoresSafeArea()
        }
        #else
        self
        #endif
    }
}
