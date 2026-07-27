import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureSeasonalPlan

/// The Seasonal plan view model's presentation mapping and its documented
/// degraded states — the same coverage shape `TodayViewModelTests` already
/// establishes (`.offline`/`.failed`/kept-but-stale on refresh failure).
@MainActor
@Suite("Seasonal plan view model")
struct SeasonalPlanViewModelTests {
    @Test("load maps calendar windows as month names and splits rotation into conflicts vs. others")
    func loadPresentsCalendarAndRotation() async throws {
        let gateway = FakeSeasonalPlanGateway(result: SeasonalPlanFixtures.result())
        let model = SeasonalPlanFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(presentation.hemisphereKnown == true)

        #expect(presentation.calendarRows.map(\.id) == ["plant-1", "plant-2"])
        let reviewedRow = try #require(presentation.calendarRows.first)
        #expect(reviewedRow.isDeemphasized == false)
        #expect(reviewedRow.noteText == nil)
        // Two configured windows (sow indoors, harvest) — month names, never
        // raw `1`-`12` integers.
        #expect(reviewedRow.windowLines.count == 2)
        #expect(reviewedRow.windowLines.first?.rangeText.contains("February") == true)
        #expect(reviewedRow.windowLines.first?.rangeText.contains("March") == true)

        #expect(presentation.rotationConflicts.map(\.id) == ["plant-1"])
        #expect(presentation.rotationConflicts.first?.isConflict == true)
        #expect(presentation.rotationConflicts.first?.descriptionText.contains("Solanaceae") == true)

        #expect(presentation.rotationOthers.map(\.id) == ["plant-2"])
        #expect(presentation.rotationOthers.first?.isConflict == false)
    }

    @Test("A noSeasonalData plant is de-emphasized, never hidden")
    func noSeasonalDataIsDeemphasizedNotHidden() async throws {
        let gateway = FakeSeasonalPlanGateway(
            result: SeasonalPlanFixtures.result(plants: [SeasonalPlanFixtures.unidentifiedPlant()])
        )
        let model = SeasonalPlanFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        let row = try #require(presentation.calendarRows.first)
        #expect(row.isDeemphasized == true)
        #expect(row.windowLines.isEmpty)
        #expect(row.noteText != nil)
    }

    @Test("hemisphere == nil renders the explicit hemisphere-unknown state, scoped to Calendar only")
    func hemisphereUnknownIsExplicit() async throws {
        let gateway = FakeSeasonalPlanGateway(result: SeasonalPlanFixtures.result(hemisphere: nil))
        let model = SeasonalPlanFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(presentation.hemisphereKnown == false)
        // Rotation is independent of hemisphere — it keeps rendering.
        #expect(presentation.rotationConflicts.isEmpty == false || presentation.rotationOthers.isEmpty == false)
    }

    @Test("A first-load transport failure degrades to the named offline state — never a fabricated view")
    func firstLoadOfflineIsNamed() async {
        let gateway = FakeSeasonalPlanGateway()
        gateway.nextFailure = .transport(code: .notConnectedToInternet, correlationId: "corr-1")
        let model = SeasonalPlanFixtures.makeModel(gateway: gateway)

        await model.load()

        #expect(model.state == .offline)
        #expect(model.offlineMessage.isEmpty == false)
    }

    @Test("A first-load backend failure uses the established failure surface")
    func firstLoadServerFailureFails() async {
        let gateway = FakeSeasonalPlanGateway()
        gateway.nextFailure = .service(
            APIErrorBody(code: "shared.internal", message: "boom", correlationId: "corr", retryable: false),
            statusCode: 500,
            retryAfterSeconds: nil
        )
        let model = SeasonalPlanFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case .failed = model.state else {
            Issue.record("Expected failed state")
            return
        }
    }

    @Test("A failed refresh keeps the last-fetched plan on screen behind a staleness notice")
    func refreshFailureKeepsLastResultStale() async throws {
        let gateway = FakeSeasonalPlanGateway()
        let model = SeasonalPlanFixtures.makeModel(gateway: gateway)

        await model.load()
        guard case .loaded = model.state else {
            Issue.record("Expected loaded state after first load")
            return
        }
        #expect(model.staleNoticeText == nil)

        gateway.nextFailure = .transport(code: .timedOut, correlationId: "corr-2")
        await model.load()

        // The state stays `.loaded` — the last-fetched plan is kept, not
        // blanked — with an explicit staleness notice naming the load time.
        guard case .loaded = model.state else {
            Issue.record("Expected the loaded state to be kept on a failed refresh")
            return
        }
        #expect(model.staleNoticeText != nil)
    }

    @Test("An empty seasonal plan is a loaded state, not an error")
    func emptyPlanIsLoaded() async throws {
        let gateway = FakeSeasonalPlanGateway(result: SeasonalPlanFixtures.result(plants: [], rotationStatus: []))
        let model = SeasonalPlanFixtures.makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(presentation.calendarRows.isEmpty)
        #expect(presentation.rotationConflicts.isEmpty)
        #expect(presentation.rotationOthers.isEmpty)
    }
}
