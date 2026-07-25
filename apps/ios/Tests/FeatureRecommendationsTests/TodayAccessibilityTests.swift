import CoreDomain
import CoreLocalization
import Foundation
import Testing

@testable import FeatureRecommendations

/// The spoken form of a Today row.
///
/// `TodayView` renders each row as a `VStack` of up to eight `Text` views,
/// three of which are a bare "·" separator. Before P8-UX-01 those were eight
/// separate accessibility elements, so VoiceOver required eight swipes to
/// cross one row and pronounced "middle dot" three times on the way. The view
/// now collapses the row into one element named by
/// `TodayItemPresentation.accessibilityLabel`, which is a pure value and can
/// therefore be asserted here without a simulator.
///
/// What this cannot check is VoiceOver's own reading — pronunciation,
/// rotor behaviour, and the actual traversal order need a device. See the
/// P8-UX-01 sign-off note.
@MainActor
@Suite("Today accessibility")
struct TodayAccessibilityTests {
    private func loadedItems(
        _ gateway: FakeRecommendationGateway
    ) async throws -> [TodayItemPresentation] {
        let model = TodayFixtures.makeModel(gateway: gateway)
        await model.load()

        guard case let .loaded(items) = model.state else {
            Issue.record("Expected loaded state")
            return []
        }
        return items
    }

    @Test("A row is spoken as one sentence carrying every field it shows")
    func labelCarriesEveryVisibleField() async throws {
        let items = try await loadedItems(FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "rec-1", priorityScore: 72)
        ]))
        let item = try #require(items.first)
        let label = item.accessibilityLabel

        // Everything the row renders visually is in the spoken label: a
        // sighted reader and a VoiceOver reader must not receive different
        // information about the same recommendation.
        #expect(label.contains(item.actionTitle))
        #expect(label.contains(item.targetLabel))
        #expect(label.contains(item.urgencyLabel))
        #expect(label.contains(item.priorityScoreText))
        #expect(label.contains(item.explanation))
        #expect(label.contains(try #require(item.windowText)))
        #expect(label.contains(try #require(item.uncertaintyText)))
    }

    @Test("The action comes first, so a reader can skip a row after one phrase")
    func labelLeadsWithTheAction() async throws {
        let items = try await loadedItems(FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "rec-1")
        ]))
        let item = try #require(items.first)

        #expect(item.accessibilityLabel.hasPrefix(item.actionTitle))
    }

    @Test("The separator glyphs the row draws never reach the label")
    func labelHasNoDecorativeGlyphs() async throws {
        let items = try await loadedItems(FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "rec-1")
        ]))
        let item = try #require(items.first)

        #expect(!item.accessibilityLabel.contains("·"))
        #expect(!item.accessibilityLabel.contains(", ,"))
    }

    @Test("An elevated-risk row says so out loud, not only in orange")
    func elevatedRiskIsSpoken() async throws {
        let items = try await loadedItems(FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "risky", safetyTier: .elevatedRisk),
            TodayFixtures.todayItem(id: "ordinary"),
        ]))

        let risky = try #require(items.first { $0.id == "risky" })
        let ordinary = try #require(items.first { $0.id == "ordinary" })

        // Colour alone must never carry the safety tier.
        #expect(risky.accessibilityLabel.contains(risky.safetyTierLabel))
        #expect(!ordinary.accessibilityLabel.contains(ordinary.safetyTierLabel))
    }

    @Test("A row with no window or uncertainty leaves no empty fragment behind")
    func labelSkipsAbsentFields() async throws {
        let items = try await loadedItems(FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "rec-1", windowStart: nil, windowEnd: nil)
        ]))
        let item = try #require(items.first)

        #expect(item.windowText == nil)
        #expect(!item.accessibilityLabel.contains(", ,"))
        #expect(!item.accessibilityLabel.hasSuffix(","))
    }

    @Test("The spoken label is in the reader's language, like the row itself")
    func labelIsLocalized() async throws {
        let russian = TodayFixtures.makeModel(
            gateway: FakeRecommendationGateway(items: [TodayFixtures.todayItem(id: "rec-1")]),
            strings: LocalizedStrings(locale: Locale(identifier: "ru_RU"))
        )
        await russian.load()

        guard case let .loaded(items) = russian.state, let item = items.first else {
            Issue.record("Expected loaded state")
            return
        }

        // The urgency label is catalogue text, so it proves the whole spoken
        // sentence follows the injected locale rather than the process one.
        #expect(item.accessibilityLabel.contains(item.urgencyLabel))
        #expect(!item.accessibilityLabel.contains("High"))
    }
}
