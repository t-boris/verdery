import Foundation

#if canImport(VisionKit) && os(iOS)
    import SwiftUI
    import UIKit
    import VisionKit

    /// Photographing a paper drawing, with the edges found for you.
    ///
    /// A plat of survey arrives as a sheet of paper far more often than as a
    /// file. Photographing one with the ordinary camera produces a picture of a
    /// desk with a drawing on it, taken at an angle, and everything downstream
    /// — calibration, tracing, text extraction — then works against that
    /// perspective. `VNDocumentCameraViewController` finds the page edges,
    /// corrects the perspective and returns a flat rectangle, which is what the
    /// rest of the pipeline was designed for.
    ///
    /// It is the system scanner rather than a hand-rolled one on purpose: edge
    /// detection under a kitchen light is a hard problem Apple has already
    /// solved, and it needs no photo-library permission — the same reason
    /// `PhotosPicker` is used elsewhere.
    ///
    /// Multi-page scans are flattened to their **first** page. A garden plan is
    /// one drawing; a scanner that quietly attached page three would be
    /// attaching something nobody chose.
    public struct DocumentScanner: UIViewControllerRepresentable {
        private let onScan: (Data) -> Void
        private let onCancel: () -> Void
        /// JPEG rather than PNG: a scanned drawing is a photograph of ink on
        /// paper, and PNG would triple the bytes of an upload somebody is
        /// making on a phone connection for no visible gain.
        private let compressionQuality: CGFloat

        public init(
            compressionQuality: CGFloat = 0.9,
            onScan: @escaping (Data) -> Void,
            onCancel: @escaping () -> Void
        ) {
            self.compressionQuality = compressionQuality
            self.onScan = onScan
            self.onCancel = onCancel
        }

        public static var isSupported: Bool {
            VNDocumentCameraViewController.isSupported
        }

        public func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
            let controller = VNDocumentCameraViewController()
            controller.delegate = context.coordinator
            return controller
        }

        public func updateUIViewController(
            _: VNDocumentCameraViewController,
            context _: Context
        ) {}

        public func makeCoordinator() -> Coordinator {
            Coordinator(compressionQuality: compressionQuality, onScan: onScan, onCancel: onCancel)
        }

        public final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
            private let compressionQuality: CGFloat
            private let onScan: (Data) -> Void
            private let onCancel: () -> Void

            init(
                compressionQuality: CGFloat,
                onScan: @escaping (Data) -> Void,
                onCancel: @escaping () -> Void
            ) {
                self.compressionQuality = compressionQuality
                self.onScan = onScan
                self.onCancel = onCancel
            }

            public func documentCameraViewController(
                _: VNDocumentCameraViewController,
                didFinishWith scan: VNDocumentCameraScan
            ) {
                guard
                    scan.pageCount > 0,
                    let data = scan.imageOfPage(at: 0).jpegData(
                        compressionQuality: compressionQuality
                    )
                else {
                    onCancel()
                    return
                }
                onScan(data)
            }

            public func documentCameraViewControllerDidCancel(
                _: VNDocumentCameraViewController
            ) {
                onCancel()
            }

            /// A scanner failure is a cancellation as far as this application is
            /// concerned: nothing was produced, and there is nothing to report
            /// beyond "no drawing arrived", which the screen already shows by
            /// having no attachment.
            public func documentCameraViewController(
                _: VNDocumentCameraViewController,
                didFailWithError _: Error
            ) {
                onCancel()
            }
        }
    }
#endif
