import Foundation
import Observation

#if os(iOS)
import AVFoundation
import UIKit
#endif

/// A camera that stays open between shots.
///
/// `UIImagePickerController` — what every photo-attach point in this
/// application uses today — presents, takes one photograph, and dismisses.
/// Re-presenting it per shot costs roughly a second each and makes
/// photographing eleven plants down a bed eleven separate errands. This keeps
/// one `AVCaptureSession` running so the shutter can fire again immediately.
///
/// Its authority is `docs/implementation-plan.md` section 26.3, which lists
/// "camera-first offline-capable repeated observations with background upload"
/// as **Required** for iPhone. It is not the garden-object capture pipeline
/// ADR-0015 removed — that was reconstructing beds and structures from
/// photographs, and its `P10-IOS-01`/`P10-IOS-02` were the guided capture UI
/// for *that*.
///
/// Everything about the session is confined here; the view is a preview layer
/// and a shutter button.
@MainActor
@Observable
public final class CaptureSessionController {
    public enum Availability: Sendable, Equatable {
        case ready
        case denied
        case unavailable
    }

    public private(set) var availability: Availability = .unavailable
    /// Rises on every shot, so a view can flash or count without owning state.
    public private(set) var shotCount = 0

    /// Called with prepared JPEG data for each photograph, on the main actor.
    @ObservationIgnored public var onCapture: (@MainActor (Data) -> Void)?

    #if os(iOS)
    @ObservationIgnored let session = AVCaptureSession()
    /// Starting and stopping both block until the pipeline settles, which on
    /// the main actor is a visible freeze on the way in and a stutter on the
    /// way out. Apple's own guidance is one serial queue; this is it.
    @ObservationIgnored private let sessionQueue = DispatchQueue(
        label: "com.verdery.app.capture-session"
    )
    @ObservationIgnored private let output = AVCapturePhotoOutput()
    @ObservationIgnored private var delegate: PhotoCaptureDelegate?
    @ObservationIgnored private var isConfigured = false
    #endif

    public init() {}

    /// Asks for permission if it has not been asked, then starts the session.
    ///
    /// Contextual rather than at launch, per `ios-application-design.md`
    /// section 17: the request arrives when somebody has just tapped a camera
    /// button, which is the moment the reason for it is obvious.
    public func start() async {
        #if os(iOS)
        guard AVCaptureDevice.default(for: .video) != nil else {
            availability = .unavailable
            return
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            guard await AVCaptureDevice.requestAccess(for: .video) else {
                availability = .denied
                return
            }
        case .denied, .restricted:
            availability = .denied
            return
        @unknown default:
            availability = .unavailable
            return
        }

        configureIfNeeded()
        guard isConfigured else {
            availability = .unavailable
            return
        }
        availability = .ready
        startRunning()
        #endif
    }

    public func stop() {
        #if os(iOS)
        let box = SessionBox(session: session)
        sessionQueue.async { box.session.stopRunning() }
        #endif
    }

    /// Fires the shutter. A no-op unless the session is running, so a rapid
    /// double tap cannot queue a photograph against a torn-down session.
    public func capture() {
        #if os(iOS)
        guard availability == .ready, session.isRunning else { return }

        let settings = AVCapturePhotoSettings()
        // AVFoundation calls its delegate off the main actor, so the hop is
        // explicit. Swift 6 rejects the alternative outright, which is why the
        // iOS build catches this and the headless macOS one — where the whole
        // block is compiled out — cannot.
        let delegate = PhotoCaptureDelegate { [weak self] data in
            guard let data else { return }
            Task { @MainActor in
                guard let self else { return }
                self.shotCount += 1
                self.onCapture?(data)
            }
        }
        // Held for the duration of the capture: AVFoundation keeps only an
        // unowned reference, and a delegate released before the callback is a
        // photograph that silently never arrives.
        self.delegate = delegate
        output.capturePhoto(with: settings, delegate: delegate)
        #endif
    }

    #if os(iOS)
    private func configureIfNeeded() {
        guard !isConfigured else { return }
        guard
            let device = AVCaptureDevice.default(
                .builtInWideAngleCamera, for: .video, position: .back
            ),
            let input = try? AVCaptureDeviceInput(device: device)
        else {
            return
        }

        session.beginConfiguration()
        session.sessionPreset = .photo
        if session.canAddInput(input) { session.addInput(input) }
        if session.canAddOutput(output) { session.addOutput(output) }
        session.commitConfiguration()
        isConfigured = session.inputs.isEmpty == false && session.outputs.isEmpty == false
    }

    private func startRunning() {
        guard !session.isRunning else { return }
        let box = SessionBox(session: session)
        sessionQueue.async { box.session.startRunning() }
    }
    #endif
}

#if os(iOS)
/// Carries the session across to its own queue.
///
/// `AVCaptureSession` is not `Sendable` and never will be — it is a mutable
/// UIKit-era object. `@unchecked` is sound here because every call that
/// touches it off the main actor goes through `sessionQueue`, one serial
/// queue, and the only two such calls are `startRunning`/`stopRunning`.
private struct SessionBox: @unchecked Sendable {
    let session: AVCaptureSession
}

/// AVFoundation's callback is a delegate protocol, not a closure or an async
/// call, so one object per capture bridges it back.
private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate, @unchecked
    Sendable
{
    private let completion: @Sendable (Data?) -> Void

    init(completion: @escaping @Sendable (Data?) -> Void) {
        self.completion = completion
    }

    func photoOutput(
        _: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        completion(error == nil ? photo.fileDataRepresentation() : nil)
    }
}
#endif
