import Foundation
import Testing

/// Executable form of this application's form-free rule, checked against the
/// source itself.
///
/// The rule is a product decision, not a preference: every screen here is used
/// one-handed, outdoors, often with gloves on, and SwiftUI's stock form
/// controls are all built for a desk. A wheel is the slowest way to say
/// "tomorrow"; a menu hides every option but the chosen one behind a tap; a
/// bordered box around a note makes prose look like data entry.
///
/// Reaching zero took a dozen passes across twenty files. Without this test it
/// would last until the next screen: `Toggle` is four characters shorter than
/// `SwitchTile` and does something that looks the same, and nobody adding one
/// would be doing anything they thought was wrong.
///
/// `CoreDesignSystem/Input/` is exempt on purpose. That is where the four
/// primitives live — `ComposerField`, `NoteCanvas`, `SearchStrip`,
/// `MeasureField` — and a `TextField` inside one of them is the point: the
/// locale separator, the placeholder, the commit affordance and the accessible
/// name are decided there once instead of eighty times.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation";
/// the redesign's own "as few forms as possible" requirement.
@Suite("Form-free conventions")
struct FormFreeConventionTests {
    private static let sourcesDirectory: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Tests/ArchitectureTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .appendingPathComponent("Sources")

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

    /// Where a stock control is allowed to appear, and why.
    ///
    /// Deliberately a short list of exact directories rather than a pattern: an
    /// allowlist that can be satisfied by naming a new file cleverly is not an
    /// allowlist.
    private static let exemptPrefixes = [
        // The four input primitives. A `TextField` here is the whole point.
        "CoreDesignSystem/Input/",
        // `SegmentedRail` and `CompassDial` name the controls they replace in
        // their own doc comments, and `SwitchTile` explains what a `Toggle`
        // would have got wrong.
        "CoreDesignSystem/Choice/",
    ]

    /// Lines matching `pattern` outside the exempt directories, as
    /// `path:line text`. Comment-only lines are skipped: a line that says why a
    /// control is *not* used is not a use of it.
    private static func occurrences(of pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }

        var found: [String] = []
        for file in swiftFiles where !exemptPrefixes.contains(where: file.path.hasPrefix) {
            for (index, line) in file.text.components(separatedBy: "\n").enumerated() {
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
        // If this stops matching, the exemption below is protecting nothing and
        // the whole suite could be passing over an empty set.
        #expect(Self.swiftFiles.contains { $0.path == "CoreDesignSystem/Input/ComposerField.swift" })
        #expect(Self.swiftFiles.contains { $0.path.hasPrefix("FeaturePlants/") })
    }

    /// A `Form` is a table of labelled rows, which is a shape for entering
    /// records rather than for tending a garden.
    @Test("No screen builds a Form")
    func noForms() {
        let found = Self.occurrences(of: #"(^|[^A-Za-z])Form\s*\{"#)
        #expect(found.isEmpty, "Use a `VStack` of cards. Found: \(found)")
    }

    /// A `Picker` shows one option and hides the rest behind a tap, which is
    /// exactly wrong when the question is "which of these".
    @Test("No screen uses a Picker")
    func noPickers() {
        // `PhotosPicker` is a different control and is deliberately kept: it
        // runs out of process and grants no photo-library access, which is why
        // this application declares no library usage string.
        let found = Self.occurrences(of: #"(^|[^A-Za-z])Picker\("#)
            .filter { !$0.contains("PhotosPicker(") }
        #expect(found.isEmpty, "Use `ChoiceChipGrid` or `SegmentedRail`. Found: \(found)")
    }

    /// Every `Toggle` this application ever had was the presence of an optional
    /// value wearing a boolean's clothes, gating a hidden date control.
    @Test("No screen uses a Toggle")
    func noToggles() {
        let found = Self.occurrences(of: #"(^|[^A-Za-z])Toggle\("#)
        #expect(found.isEmpty, "Use `SwitchTile` or `OptionalValueCard`. Found: \(found)")
    }

    /// A wheel is the slowest way to answer "when".
    @Test("No screen uses a DatePicker")
    func noDatePickers() {
        let found = Self.occurrences(of: #"(^|[^A-Za-z])DatePicker\("#)
        #expect(found.isEmpty, "Use `DateDial` or `TimeWindowBar`. Found: \(found)")
    }

    @Test("No screen uses a Stepper or a Slider")
    func noSteppersOrSliders() {
        let found = Self.occurrences(of: #"(^|[^A-Za-z])Stepper\("#)
            + Self.occurrences(of: #"(^|[^A-Za-z])Slider\("#)
        #expect(found.isEmpty, "Use `MeasureField` or `ValueDial`. Found: \(found)")
    }

    /// A bordered box is for something a reader must identify as a control.
    /// Drawn around prose it makes a screen look like a form for no gain, and
    /// the four input primitives already decide their own borders.
    @Test("No screen draws a bordered text field")
    func noBorderedFields() {
        let found = Self.occurrences(of: #"\.textFieldStyle\("#)
        #expect(found.isEmpty, "The input primitives own their borders. Found: \(found)")
    }

    /// The rule that keeps the other seven honest: text entry goes through the
    /// four primitives, so the locale separator, the placeholder, the commit
    /// affordance and the accessible name are decided once.
    @Test("Text entry goes through the design system's own inputs")
    func textFieldsAreConfined() {
        let found = Self.occurrences(of: #"(^|[^A-Za-z])TextField\("#)
        #expect(
            found.isEmpty,
            "Use `ComposerField`, `NoteCanvas`, `SearchStrip` or `MeasureField`. Found: \(found)"
        )
    }
}
