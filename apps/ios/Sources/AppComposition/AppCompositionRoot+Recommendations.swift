import CoreNetworking
import FeatureRecommendations

/// The Today screen's factory — split from `AppCompositionRoot.swift` the same
/// way `AppCompositionRoot+Plants.swift` and its siblings already are, purely
/// to keep that file under this repository's 600-line rule.
extension AppCompositionRoot {
    public func makeTodayViewModel(gardenId: String) -> TodayViewModel {
        TodayViewModel(
            gardenId: gardenId,
            loadToday: LoadToday(gateway: recommendationGateway),
            completeRecommendation: CompleteRecommendation(gateway: recommendationGateway),
            postponeRecommendation: PostponeRecommendation(gateway: recommendationGateway),
            dismissRecommendation: DismissRecommendation(gateway: recommendationGateway),
            markRecommendationIrrelevant: MarkRecommendationIrrelevant(gateway: recommendationGateway),
            convertRecommendationToTask: ConvertRecommendationToTask(gateway: recommendationGateway),
            strings: strings,
            // Two of the rules read weather and their stored explanations
            // quote the exact reading they fired on, so the readings belong
            // above the list they produced.
            conditions: ConditionsController(
                getWeather: FeatureRecommendations.GetGardenWeather(gateway: weatherGateway),
                strings: strings
            ),
            notifications: makeNotificationInboxViewModel()
        )
    }
}
