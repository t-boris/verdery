import CoreDesignSystem
import SwiftUI

#if os(iOS)
import AVFoundation
import UIKit
#endif

/// The camera, as a screen you stay on.
///
/// Shutter, haptic, counter, shutter again. Nothing returns to a list between
/// shots, because the unit of work in a garden is a walk down a bed rather
/// than one plant.
///
/// Built for a hand that is holding something else. Every control sits in the
/// bottom third; the shutter is far larger than the 44-point minimum because
/// it is aimed at rather than tapped; the volume buttons fire it too, which is
/// what makes it usable with gloves and without looking; and the screen goes
/// to full brightness on the way in, because the alternative outdoors is a
/// viewfinder nobody can see.
public struct CaptureSurfaceView: View {
    private let title: String
    private let doneLabel: String
    private let shutterLabel: String
    private let permissionDeniedMessage: String
    private let openSettingsLabel: String
    private let unavailableMessage: String
    @Bindable private var controller: CaptureSessionController
    private let done: () -> Void

    @ScaledSize(Metrics.space8, relativeTo: .largeTitle) private var shutterSize
    @State private var previousBrightness: CGFloat?

    public init(
        controller: CaptureSessionController,
        title: String,
        doneLabel: String,
        shutterLabel: String,
        permissionDeniedMessage: String,
        openSettingsLabel: String,
        unavailableMessage: String,
        done: @escaping () -> Void
    ) {
        self.controller = controller
        self.title = title
        self.doneLabel = doneLabel
        self.shutterLabel = shutterLabel
        self.permissionDeniedMessage = permissionDeniedMessage
        self.openSettingsLabel = openSettingsLabel
        self.unavailableMessage = unavailableMessage
        self.done = done
    }

    public var body: some View {
        ZStack {
            // Always dark, whatever the appearance: this screen is a
            // viewfinder, and chrome around a photograph competes with it.
            Color.black.ignoresSafeArea()

            switch controller.availability {
            case .ready:
                viewfinder
            case .denied:
                message(permissionDeniedMessage, showsSettings: true)
            case .unavailable:
                message(unavailableMessage, showsSettings: false)
            }

            controls
        }
        .task {
            await controller.start()
            raiseBrightness()
        }
        .onDisappear {
            controller.stop()
            restoreBrightness()
        }
    }

    @ViewBuilder
    private var viewfinder: some View {
        #if os(iOS)
        CameraPreview(session: controller.session)
            .ignoresSafeArea()
        #else
        Color.black
        #endif
    }

    private var controls: some View {
        VStack {
            HStack {
                Button(doneLabel, action: done)
                    .font(FieldConsoleType.bodyStrong.font)
                    .foregroundStyle(Palette.consoleText)
                    .accessibilityIdentifier("capture.done")
                Spacer()
                if controller.shotCount > 0 {
                    Text(String(controller.shotCount))
                        .font(FieldConsoleType.metric.font)
                        .foregroundStyle(Palette.consoleText)
                        .contentTransition(.numericText())
                        .padding(.horizontal, Metrics.space3)
                        .padding(.vertical, Metrics.space1)
                        .background(Capsule().fill(Palette.consoleSelected))
                        .accessibilityIdentifier("capture.count")
                }
            }
            .padding(Metrics.space4)

            Spacer()

            if controller.availability == .ready {
                shutter
                    .padding(.bottom, Metrics.space6)
            }
        }
    }

    private var shutter: some View {
        Button {
            controller.capture()
        } label: {
            Circle()
                .fill(.white)
                .frame(width: shutterSize, height: shutterSize)
                .overlay(
                    Circle().strokeBorder(Palette.consoleText, lineWidth: Metrics.focusRingWidth)
                        .padding(-Metrics.space1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(shutterLabel)
        .accessibilityIdentifier("capture.shutter")
        // A distinct pulse per shot, so the phone confirms the photograph in a
        // way a person feels rather than has to look for.
        .sensoryFeedback(.impact(weight: .medium), trigger: controller.shotCount)
    }

    private func message(_ text: String, showsSettings: Bool) -> some View {
        VStack(spacing: Metrics.space3) {
            Text(text)
                .font(FieldConsoleType.body.font)
                .foregroundStyle(Palette.consoleText)
                .multilineTextAlignment(.center)
            if showsSettings {
                Button(openSettingsLabel) { CameraCapture.openSettings() }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("capture.openSettings")
            }
        }
        .padding(Metrics.space5)
    }

    private func raiseBrightness() {
        #if os(iOS)
        previousBrightness = UIScreen.main.brightness
        UIScreen.main.brightness = 1
        #endif
    }

    private func restoreBrightness() {
        #if os(iOS)
        if let previousBrightness { UIScreen.main.brightness = previousBrightness }
        #endif
    }
}

#if os(iOS)
/// The live preview. A `UIViewRepresentable` because
/// `AVCaptureVideoPreviewLayer` is a `CALayer` and SwiftUI has no equivalent.
private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context _: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_: PreviewView, context _: Context) {}

    final class PreviewView: UIView {
        override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        // Force-cast is sound: `layerClass` above guarantees the type, and
        // UIKit builds the layer from it.
        var previewLayer: AVCaptureVideoPreviewLayer {
            layer as! AVCaptureVideoPreviewLayer  // swiftlint:disable:this force_cast
        }
    }
}
#endif
