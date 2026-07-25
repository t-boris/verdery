import Foundation
import Testing

/// Executable form of the accessibility conventions this application commits
/// to, checked against the source itself.
///
/// The three properties below cannot be asserted from a view model, and this
/// package has no UI-test target: whether a font scales, whether an animation
/// consults the reader's motion preference, and whether a number is formatted
/// for a locale are all properties of the *view code*. A source scan is the
/// only automated check available for them without a simulator, and it is a
/// real one — each rule below corresponds to a defect this work package
/// actually found and fixed, so each would have caught it.
///
/// What this cannot do is verify how the result looks or sounds. Rendering at
/// an accessibility text size, and VoiceOver's actual reading order, need a
/// device or a simulator; see the sign-off note for P8-UX-01.
///
/// Source: architecture/ios-application-design.md, section "19. Testing";
/// technical-specification.md, section 11; work package P8-UX-01.
@Suite("Accessibility conventions")
struct AccessibilityConventionTests {
    private static let sourcesDirectory: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Tests/ArchitectureTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .appendingPathComponent("Sources")

    /// Every Swift file under `Sources`, as (path relative to `Sources`, text).
    private static let swiftFiles: [(path: String, text: String)] = {
        guard
            let enumerator = FileManager.default.enumerator(
                at: sourcesDirectory,
                includingPropertiesForKeys: nil
            )
        else {
            return []
        }

        var files: [(path: String, text: String)] = []
        for case let url as URL in enumerator where url.pathExtension == "swift" {
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            let relative = url.path.replacingOccurrences(of: sourcesDirectory.path + "/", with: "")
            files.append((path: relative, text: text))
        }
        return files.sorted { $0.path < $1.path }
    }()

    /// Lines matching `pattern`, reported as `path:line text`.
    private static func occurrences(of pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }

        var found: [String] = []
        for file in swiftFiles {
            for (index, line) in file.text.components(separatedBy: "\n").enumerated() {
                // A line that is only a comment describes code; it is not code.
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("//") || trimmed.hasPrefix("///") || trimmed.hasPrefix("*") {
                    continue
                }
                let range = NSRange(line.startIndex..<line.endIndex, in: line)
                if regex.firstMatch(in: line, range: range) != nil {
                    found.append("\(file.path):\(index + 1) \(trimmed)")
                }
            }
        }
        return found
    }

    @Test("The scan reads the real source tree")
    func scanIsNotVacuous() {
        #expect(Self.swiftFiles.count > 100)
        #expect(Self.swiftFiles.contains { $0.path.hasSuffix("FeatureMap/MapEditorView.swift") })
        #expect(Self.swiftFiles.contains { $0.path.hasSuffix("FeatureRecommendations/TodayView.swift") })
    }

    /// Dynamic Type.
    ///
    /// A point size written into `.font(.system(size:))` or `UIFont` is fixed
    /// forever: it ignores the reader's text-size setting entirely, which is
    /// the single setting most low-vision readers change first. Every text
    /// style in this application is therefore semantic (`.body`, `.headline`,
    /// `.caption`, …), which the system scales.
    @Test("No view hard-codes a font size")
    func fontsAreSemantic() {
        let hardCoded =
            Self.occurrences(of: #"\.font\(\.system\(size:"#)
            + Self.occurrences(of: #"Font\.system\(size:"#)
            + Self.occurrences(of: #"UIFont\.systemFont\(ofSize:"#)

        #expect(hardCoded.isEmpty, "Hard-coded font sizes:\n\(hardCoded.joined(separator: "\n"))")
    }

    /// Dynamic Type, second half.
    ///
    /// A fixed `frame(width:)`/`frame(height:)` around text clips it at the
    /// larger sizes just as surely as a fixed font would. `@ScaledMetric` is
    /// the supported way to keep a dimension proportional to the reader's
    /// text size, so a literal dimension must be one.
    @Test("No fixed frame dimension escapes @ScaledMetric")
    func fixedDimensionsAreScaled() {
        let literalFrames = Self.occurrences(
            of: #"\.frame\((maxWidth|maxHeight|width|height): *[0-9]"#
        )

        #expect(
            literalFrames.isEmpty,
            "Fixed frame dimensions that should be @ScaledMetric:\n\(literalFrames.joined(separator: "\n"))"
        )
    }

    /// Reduced motion.
    ///
    /// This application currently animates nothing, so the rule is forward
    /// looking by design: the first `withAnimation` or `.animation(` added
    /// must arrive together with a read of
    /// `@Environment(\.accessibilityReduceMotion)`, in the same file. Written
    /// as a test rather than a review habit because "respect the motion
    /// preference" is exactly the kind of requirement that is remembered
    /// while it is topical and forgotten afterwards.
    @Test("Any animation consults the reader's reduced-motion preference")
    func animationsRespectReducedMotion() {
        let animatingFiles = Set(
            (Self.occurrences(of: #"withAnimation"#) + Self.occurrences(of: #"\.animation\("#))
                .map { String($0.prefix(while: { $0 != ":" })) }
        )

        for path in animatingFiles.sorted() {
            let text = Self.swiftFiles.first { $0.path == path }?.text ?? ""
            #expect(
                text.contains("accessibilityReduceMotion"),
                "\(path) animates without reading accessibilityReduceMotion."
            )
        }
    }

    /// Localization of numbers.
    ///
    /// `String(format: "%.1f", …)` always emits the POSIX decimal separator,
    /// so a Russian reader saw `1.5` inside otherwise-Russian prose. Numbers
    /// shown to a reader go through `LocalizedStrings.number(_:fractionDigits:)`,
    /// which formats for the injected locale.
    @Test("No user-facing number is formatted with a POSIX format string")
    func numbersAreLocaleFormatted() {
        let posix = Self.occurrences(of: #"String\(format: *"%\.[0-9]"#)

        #expect(
            posix.isEmpty,
            "POSIX-formatted numbers reach the user:\n\(posix.joined(separator: "\n"))"
        )
    }

    /// VoiceOver naming.
    ///
    /// A `Picker`, `TextField`, or `Toggle` given an empty string as its title
    /// has no accessible name at all — the segments or the value are all
    /// VoiceOver can announce. `MapEditorView`'s canvas/list switcher shipped
    /// exactly that way until this work package.
    @Test("No control is declared with an empty title")
    func controlsAreNamed() {
        let unnamed = Self.occurrences(of: #"(Picker|TextField|Toggle|Button|Section)\(""\s*[,)]"#)

        #expect(
            unnamed.isEmpty,
            "Controls with an empty accessible name:\n\(unnamed.joined(separator: "\n"))"
        )
    }
}
