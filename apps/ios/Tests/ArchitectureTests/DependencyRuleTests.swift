import Foundation
import Testing

/// Executable form of the dependency rule.
///
/// The rule — features depend on Core, Core never depends on a feature — is
/// otherwise enforced only by whoever reviews a change to `Package.swift`. It is
/// checked here because an inverted dependency is cheap to add and expensive to
/// unwind once several features rely on it.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency Rules".
@Suite("Dependency rules")
struct DependencyRuleTests {
    private static let manifest: String = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // Tests/ArchitectureTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // apps/ios
            .appendingPathComponent("Package.swift")

        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }()

    /// Target declarations keyed by name, each mapped to the names it references.
    private static func declaredDependencies() -> [String: [String]] {
        var dependencies: [String: [String]] = [:]

        for block in manifest.components(separatedBy: ".target(").dropFirst()
            + manifest.components(separatedBy: ".executableTarget(").dropFirst()
        {
            guard let name = firstQuotedValue(after: "name:", in: block) else { continue }

            dependencies[name] = quotedValues(inDependenciesOf: block)
        }

        return dependencies
    }

    @Test("The manifest is readable from the test target")
    func manifestIsReadable() {
        #expect(Self.manifest.contains("name: \"Verdery\""))
        #expect(!Self.declaredDependencies().isEmpty)
    }

    @Test("No Core target depends on a feature")
    func coreDoesNotDependOnFeatures() {
        for (target, dependencies) in Self.declaredDependencies() where target.hasPrefix("Core") {
            let inverted = dependencies.filter { $0.hasPrefix("Feature") }

            #expect(inverted.isEmpty, "\(target) depends on \(inverted.joined(separator: ", ")).")
        }
    }

    @Test("No feature depends on another feature")
    func featuresDoNotDependOnEachOther() {
        for (target, dependencies) in Self.declaredDependencies() where target.hasPrefix("Feature") {
            let siblings = dependencies.filter { $0.hasPrefix("Feature") && $0 != target }

            #expect(siblings.isEmpty, "\(target) depends on \(siblings.joined(separator: ", ")).")
        }
    }

    @Test("Only the composition root and the entry point know every layer")
    func compositionIsTheOnlyAggregator() {
        let dependencies = Self.declaredDependencies()
        let aggregators = dependencies
            .filter { $0.value.contains { $0.hasPrefix("Feature") } }
            .keys
            .sorted()

        #expect(aggregators == ["AppComposition"])
    }

    private static func firstQuotedValue(after label: String, in block: String) -> String? {
        guard let labelRange = block.range(of: label) else { return nil }

        return quotedValues(in: String(block[labelRange.upperBound...])).first
    }

    /// Extracts the names listed in a target's `dependencies:` array.
    private static func quotedValues(inDependenciesOf block: String) -> [String] {
        guard
            let start = block.range(of: "dependencies:"),
            let open = block.range(of: "[", range: start.upperBound..<block.endIndex),
            let close = block.range(of: "]", range: open.upperBound..<block.endIndex)
        else {
            return []
        }

        return quotedValues(in: String(block[open.upperBound..<close.lowerBound]))
    }

    private static func quotedValues(in text: String) -> [String] {
        text.components(separatedBy: "\"")
            .enumerated()
            .filter { $0.offset % 2 == 1 }
            .map(\.element)
    }
}
