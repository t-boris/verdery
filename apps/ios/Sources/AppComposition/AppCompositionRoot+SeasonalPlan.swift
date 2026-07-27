import CoreDomain
import FeatureGardens
import FeatureSeasonalPlan
import Foundation

/// Factories for the Seasonal plan screen and the Context quality screen
/// (P9D-UX-01) — split from `AppCompositionRoot.swift` the same way
/// `AppCompositionRoot+Collaboration.swift` already is, purely to keep that
/// file under this repository's 600-line rule.
extension AppCompositionRoot {
    /// One garden's Seasonal plan screen, reached from a card on the Today
    /// tab. No local store and no profile id: every use case here is
    /// online, gateway-backed by deliberate decision — see
    /// `FeatureSeasonalPlan.SeasonalPlanUseCases`'s own doc comment.
    public func makeSeasonalPlanViewModel(gardenId: String) -> SeasonalPlanViewModel {
        SeasonalPlanViewModel(
            gardenId: gardenId,
            loadSeasonalPlan: LoadSeasonalPlan(gateway: seasonalPlanGateway),
            strings: strings
        )
    }

    /// One garden's Context quality screen, reached from garden settings.
    /// `callerRole` is threaded through from `GardenContextQualityRoute` —
    /// see that type's own doc comment for why the caller's role is already
    /// known rather than re-derived here.
    public func makeContextQualityViewModel(gardenId: String, callerRole: GardenRole) -> ContextQualityViewModel {
        ContextQualityViewModel(
            gardenId: gardenId,
            callerRole: callerRole,
            listGardenContextFacts: ListGardenContextFacts(gateway: gardenContextGateway),
            recordGardenContextFact: RecordGardenContextFact(gateway: gardenContextGateway),
            strings: strings
        )
    }
}
