import CoreDesignSystem
import CoreText
import Foundation
import Testing

/// That every bundled face is present, registers, and answers to the name the
/// design system asks for.
///
/// This is the highest-value test in the typography layer, because the failure
/// it guards against is invisible. `Font.custom` takes a PostScript name; when
/// that name does not exist CoreText does not raise, it substitutes the system
/// font. The result is a screen that looks *slightly* wrong — in one weight,
/// possibly only in Russian — which no build gate and no reviewer reliably
/// catches.
///
/// IBM Plex Sans makes this concrete: two of its four PostScript names are
/// abbreviated (`IBMPlexSans-Medm`, `IBMPlexSans-SmBld`) and its Regular is
/// plain `IBMPlexSans`. Nothing about the file names predicts that.
///
/// Source: Sources/CoreDesignSystem/Resources/Fonts/NOTICE.md.
@Suite("Bundled fonts")
struct FontRegistrationTests {
    @Test("every declared face ships a file and registers")
    func allFacesRegister() {
        let report = Fonts.register()
        #expect(
            report.missingFiles.isEmpty,
            """
            These faces are declared in FontFace but have no .ttf in the resource \
            bundle: \(report.missingFiles.map(\.fileName).joined(separator: ", ")).
            """
        )
        #expect(report.registered.count == FontFace.allCases.count)
    }

    /// The one that would have caught the abbreviations.
    @Test("resolves to the exact face asked for, not a substitute", arguments: FontFace.allCases)
    func resolvesWithoutSubstitution(face: FontFace) {
        Fonts.register()

        let requested = face.postScriptName
        let font = CTFontCreateWithName(requested as CFString, 16, nil)
        let resolved = CTFontCopyPostScriptName(font) as String

        #expect(
            resolved == requested,
            """
            Asked CoreText for "\(requested)" (\(face.fileName).ttf) and got "\(resolved)". \
            CoreText substitutes silently rather than failing, so this is what a wrong \
            PostScript name looks like — the text still draws, in the wrong typeface.
            """
        )
    }

    /// Registration is process-wide and must tolerate being asked twice: the
    /// type scale triggers it lazily, and a second caller must not see a
    /// different answer or pay to re-register.
    @Test("is idempotent")
    func registrationIsIdempotent() {
        let first = Fonts.register()
        let second = Fonts.register()
        #expect(first == second)
    }
}
