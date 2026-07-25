import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureRecommendations

/// The Today view model's presentation mapping and its documented degraded
/// states: a named offline state on a first-load transport failure, the
/// established failure surface for a degraded backend, an honest empty
/// state, and the kept-but-labeled-stale set when a refresh fails.
@MainActor
@Suite("Today view model")
struct TodayViewModelTests {
    @Test("load presents the prioritized set with reason, urgency, category, window, score, and uncertainty")
    func loadPresentsTheSet() async throws {
        let gateway = FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "rec-1", priorityScore: 72),
            TodayFixtures.todayItem(id: "rec-2", actionTitle: "Stake the beans", priorityScore: 40, urgency: .normal),
        ])
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(items) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.map(\.id) == ["rec-1", "rec-2"])

        let first = try #require(items.first)
        #expect(first.actionTitle == "Deep-soak the tomato bed")
        #expect(first.targetLabel == "Tomato 'Roma'")
        #expect(first.explanation == "Six dry days in a heat spell.")
        #expect(first.urgencyLabel == "High")
        #expect(first.careCategory == "watering")
        #expect(first.priorityScoreText == "Priority 72/100")
        #expect(first.windowText?.hasPrefix("Window:") == true)
        #expect(first.revision == 2)

        // FR-24's uncertainty: the confidence factor's contribution and its
        // stored basis — including the stale-weather label — as readable
        // text, exactly as the engine stored it.
        let uncertainty = try #require(first.uncertaintyText)
        #expect(uncertainty.contains("Confidence"))
        #expect(uncertainty.contains("-8"))
        #expect(uncertainty.contains("identityConfidence"))
        #expect(uncertainty.contains("weatherFreshness: stale"))

        // The full breakdown carries every stored factor in stored order.
        #expect(first.factorLines.count == 2)
        #expect(first.factorLines.first?.contains("Urgency window +40") == true)

        // Evidence in readable form; a `.null` factValue shows the key alone.
        #expect(first.evidenceLines.map(\.kindLabel) == ["Weather", "Plant identity"])
        #expect(first.evidenceLines.first?.factText == "forecastAgeHours: 26")
        #expect(first.evidenceLines.last?.factText == "displayName")
    }

    @Test("An elevated-risk item carries the caution label; ordinary care does not flag")
    func elevatedRiskIsSurfaced() async throws {
        let gateway = FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "rec-1", safetyTier: .elevatedRisk),
            TodayFixtures.todayItem(id: "rec-2", priorityScore: 10),
        ])
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(items) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.first { $0.id == "rec-1" }?.isElevatedRisk == true)
        #expect(items.first { $0.id == "rec-2" }?.isElevatedRisk == false)
    }

    @Test("A garden-targeted item labels the whole garden rather than showing nothing")
    func gardenTargetIsLabeled() async throws {
        let gateway = FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "rec-1", targetKind: .garden)
        ])
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(items) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.first?.targetLabel == "Whole garden")
    }

    @Test("An empty Today is a loaded state, not an error")
    func emptyTodayIsLoaded() async {
        let gateway = FakeRecommendationGateway()
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()

        #expect(model.state == .loaded([]))
        #expect(model.staleNoticeText == nil)
    }

    @Test("A first-load transport failure degrades to the named offline state — never a fabricated view")
    func firstLoadOfflineIsNamed() async {
        let gateway = FakeRecommendationGateway(items: [TodayFixtures.todayItem()])
        gateway.nextFailure = .transport(code: .notConnectedToInternet, correlationId: "corr-1")
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()

        #expect(model.state == .offline)
        #expect(model.offlineMessage.contains("needs a connection"))
    }

    @Test("A first-load backend failure uses the established failure surface")
    func firstLoadServerFailureFails() async {
        let gateway = FakeRecommendationGateway()
        gateway.nextFailure = FakeRecommendationGateway.serviceError(statusCode: 500, code: "shared.internal")
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case .failed = model.state else {
            Issue.record("Expected failed state")
            return
        }
    }

    @Test("A failed refresh keeps the last-fetched set behind an explicit staleness notice")
    func failedRefreshKeepsStaleSet() async {
        let gateway = FakeRecommendationGateway(items: [TodayFixtures.todayItem()])
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()
        gateway.nextFailure = .transport(code: .notConnectedToInternet, correlationId: "corr-2")
        await model.load()

        guard case let .loaded(items) = model.state else {
            Issue.record("Expected the kept loaded state")
            return
        }
        #expect(items.count == 1)
        #expect(model.staleNoticeText != nil)

        // A later successful refresh clears the notice.
        await model.load()
        #expect(model.staleNoticeText == nil)
    }
}

/// The pure rendering rules for the stored open-shaped facts.
@Suite("Today localization")
struct TodayLocalizationTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    @Test("windowText covers both-ended, end-only, start-only, and absent windows")
    func windowTextVariants() {
        let start = Date(timeIntervalSince1970: 1_785_700_000)
        let end = Date(timeIntervalSince1970: 1_785_900_000)

        #expect(TodayLocalization.windowText(start: start, end: end, strings: strings)?.hasPrefix("Window:") == true)
        #expect(TodayLocalization.windowText(start: nil, end: end, strings: strings)?.hasPrefix("Valid until") == true)
        #expect(TodayLocalization.windowText(start: start, end: nil, strings: strings)?.hasPrefix("Valid from") == true)
        #expect(TodayLocalization.windowText(start: nil, end: nil, strings: strings) == nil)
    }

    @Test("factorLine renders name, signed contribution, and key-sorted basis facts")
    func factorLineRendering() {
        let factor = RecommendationPriorityFactor(
            kind: .weatherOpportunityOrRisk,
            contribution: 12,
            basis: ["rainExpected": .bool(false), "heatWave": .bool(true)]
        )

        let line = TodayLocalization.factorLine(factor, strings: strings)

        #expect(line == "Weather opportunity or risk +12 — heatWave: true, rainExpected: false")
    }

    @Test("A factor with an empty basis renders without a dangling separator")
    func factorLineWithoutBasis() {
        let factor = RecommendationPriorityFactor(kind: .taskOverlap, contribution: -5, basis: [:])

        #expect(TodayLocalization.factorLine(factor, strings: strings) == "Task overlap -5")
    }

    @Test("displayText preserves nested structure and never invents values")
    func displayTextNesting() {
        let value = JSONValue.object([
            "flags": .array([.string("stale"), .bool(true)]),
            "count": .number(3),
            "missing": .null,
        ])

        #expect(TodayLocalization.displayText(value) == "count: 3, flags: stale, true, missing: —")
    }
}
