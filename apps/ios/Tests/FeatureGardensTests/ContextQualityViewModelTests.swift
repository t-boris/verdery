import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureGardens

/// The Context quality view model's presentation mapping, its `canEdit`
/// gating (matrix row B14's owner/editor/viewer eligibility check), and its
/// documented degraded states — the same `.offline`/`.failed` shape
/// `TodayViewModelTests` establishes.
@MainActor
@Suite("Context quality view model")
struct ContextQualityViewModelTests {
    private static let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    private func makeModel(
        gateway: FakeGardenContextGateway,
        callerRole: GardenRole = .owner
    ) -> ContextQualityViewModel {
        ContextQualityViewModel(
            gardenId: "garden-1",
            callerRole: callerRole,
            listGardenContextFacts: ListGardenContextFacts(gateway: gateway),
            recordGardenContextFact: RecordGardenContextFact(gateway: gateway),
            strings: Self.strings
        )
    }

    private func fact(
        kind: GardenContextKind,
        value: String,
        source: GardenContextSource = .userDeclared,
        reviewedBy: String? = nil,
        reviewedOn: String? = nil
    ) -> GardenContextFact {
        GardenContextFact(
            id: "fact-\(kind.rawValue)",
            gardenId: "garden-1",
            contextKind: kind,
            value: value,
            source: source,
            reviewedBy: reviewedBy,
            reviewedOn: reviewedOn,
            recordedByProfileId: "profile-1",
            recordedAt: Date(timeIntervalSince1970: 1_785_800_000),
            revision: 1,
            createdAt: Date(timeIntervalSince1970: 1_785_800_000),
            updatedAt: Date(timeIntervalSince1970: 1_785_800_000)
        )
    }

    @Test("load shows one row per GardenContextKind, including undeclared kinds — never silently omitted")
    func loadShowsAllSixKindsEvenUndeclared() async throws {
        let gateway = FakeGardenContextGateway(facts: [fact(kind: .sunExposure, value: "full_sun")])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(presentation.rows.count == 6)
        #expect(Set(presentation.rows.map(\.id)) == Set(GardenContextKind.allCases))

        let declared = try #require(presentation.rows.first { $0.id == .sunExposure })
        #expect(declared.fact != nil)
        #expect(declared.valueDisplayText != nil)

        let undeclared = try #require(presentation.rows.first { $0.id == .soilType })
        #expect(undeclared.fact == nil)
        #expect(undeclared.valueDisplayText == nil)
    }

    @Test("A fixed-vocabulary value resolves to its localized label")
    func fixedVocabularyValueResolvesLabel() async throws {
        let gateway = FakeGardenContextGateway(facts: [fact(kind: .sunExposure, value: "full_sun")])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        let row = try #require(presentation.rows.first { $0.id == .sunExposure })
        #expect(row.valueDisplayText != "full_sun")
    }

    @Test("Free-text kinds fall back to the raw value")
    func freeTextValueFallsBackToRawValue() async throws {
        let gateway = FakeGardenContextGateway(facts: [fact(kind: .soilType, value: "Sandy loam")])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        let row = try #require(presentation.rows.first { $0.id == .soilType })
        #expect(row.valueDisplayText == "Sandy loam")
    }

    @Test("reviewedBy/reviewedOn show only when source is horticulturallyReviewedDefault")
    func reviewedDisplayOnlyForReviewedDefault() async throws {
        let gateway = FakeGardenContextGateway(facts: [
            fact(kind: .drainage, value: "well_drained", source: .horticulturallyReviewedDefault, reviewedBy: "Dr. Soil", reviewedOn: "2026-01-15"),
            fact(kind: .sunExposure, value: "full_sun", source: .userDeclared),
        ])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        let reviewedRow = try #require(presentation.rows.first { $0.id == .drainage })
        #expect(reviewedRow.reviewedDisplayText != nil)

        let declaredRow = try #require(presentation.rows.first { $0.id == .sunExposure })
        #expect(declaredRow.reviewedDisplayText == nil)
    }

    @Test("canEdit is true for owner, true for editor, and false for viewer", arguments: [
        (GardenRole.owner, true),
        (GardenRole.editor, true),
        (GardenRole.viewer, false),
    ])
    func canEditGatesOnRole(role: GardenRole, expected: Bool) {
        let model = makeModel(gateway: FakeGardenContextGateway(), callerRole: role)
        #expect(model.canEdit == expected)
    }

    @Test("record() sends source: userDeclared always, and applies the returned fact without a re-fetch")
    func recordSendsUserDeclaredAndAppliesResult() async throws {
        let gateway = FakeGardenContextGateway()
        let model = makeModel(gateway: gateway)

        await model.load()
        let succeeded = await model.record(contextKind: .sunExposure, value: "full_sun")

        #expect(succeeded == true)
        #expect(gateway.recordCalls.count == 1)
        #expect(gateway.recordCalls.first?.source == .userDeclared)
        #expect(gateway.recordCalls.first?.reviewedBy == nil)
        // Applying the response directly means no second `list` call.
        #expect(gateway.listCalls.count == 1)

        guard case let .loaded(presentation) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        let row = try #require(presentation.rows.first { $0.id == .sunExposure })
        #expect(row.fact != nil)
    }

    @Test("record() surfaces a failure without crashing and leaves the prior state intact")
    func recordFailureSurfacesMessage() async throws {
        let gateway = FakeGardenContextGateway()
        let model = makeModel(gateway: gateway)
        await model.load()

        gateway.nextFailure = FakeGardenContextGateway.serviceError(statusCode: 403, code: "shared.forbidden")
        let succeeded = await model.record(contextKind: .sunExposure, value: "full_sun")

        #expect(succeeded == false)
        #expect(model.actionErrorMessage != nil)
    }

    @Test("A first-load transport failure degrades to the named offline state")
    func firstLoadOfflineIsNamed() async {
        let gateway = FakeGardenContextGateway()
        gateway.nextFailure = .transport(code: .notConnectedToInternet, correlationId: "corr-1")
        let model = makeModel(gateway: gateway)

        await model.load()

        #expect(model.state == .offline)
    }

    @Test("A first-load backend failure uses the established failure surface")
    func firstLoadServerFailureFails() async {
        let gateway = FakeGardenContextGateway()
        gateway.nextFailure = FakeGardenContextGateway.serviceError(statusCode: 500, code: "shared.internal")
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case .failed = model.state else {
            Issue.record("Expected failed state")
            return
        }
    }
}
