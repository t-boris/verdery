import CoreText
import Foundation

/// Registers the bundled typefaces with CoreText.
///
/// The faces ship as SPM resources of this target rather than as application
/// resources declared through `UIAppFonts` in `project.yml`. Two reasons: the
/// design system stays self-contained, so it does not depend on the app target
/// bundling something on its behalf; and a SwiftUI preview or a future second
/// target gets the same fonts without repeating the declaration. The cost is
/// that nothing registers them automatically, which is what this type is for.
///
/// `register()` is idempotent, cheap after the first call, and safe to call
/// from anywhere. ``Typography`` calls it on first access, so a caller that
/// forgets still renders correctly — a font that has to be switched on by
/// remembering to switch it on is a font that will be missing on some screen.
///
/// Source: Sources/CoreDesignSystem/Resources/Fonts/NOTICE.md.
public enum Fonts {
    /// What happened on the one registration attempt that runs.
    public struct Report: Sendable, Equatable {
        /// Faces whose file was found and handed to CoreText.
        public let registered: [FontFace]
        /// Faces whose file was missing from the bundle entirely.
        public let missingFiles: [FontFace]

        public var isComplete: Bool { missingFiles.isEmpty }
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var report: Report?

    /// Registers every bundled face, once per process.
    ///
    /// The result is returned rather than logged so a test can assert it. A
    /// production caller ignores it: there is no useful recovery from a font
    /// that failed to register, and CoreText's own substitution is a better
    /// outcome than refusing to draw.
    @discardableResult
    public static func register() -> Report {
        lock.lock()
        defer { lock.unlock() }
        if let report { return report }

        var registered: [FontFace] = []
        var missing: [FontFace] = []

        for face in FontFace.allCases {
            guard
                let url = Bundle.module.url(
                    forResource: face.fileName,
                    withExtension: "ttf",
                    subdirectory: "Fonts"
                )
                    ?? Bundle.module.url(forResource: face.fileName, withExtension: "ttf")
            else {
                missing.append(face)
                continue
            }

            // A face already registered by an earlier process-wide call — or
            // by the host application — reports `alreadyRegistered`, which is
            // success for this purpose. Anything else leaves the face to
            // CoreText's substitution, which is why the outcome is recorded
            // rather than thrown: a missing weight must not stop an app from
            // launching.
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            registered.append(face)
        }

        let result = Report(registered: registered, missingFiles: missing)
        report = result
        return result
    }
}
