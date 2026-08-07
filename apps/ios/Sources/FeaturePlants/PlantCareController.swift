import CoreDesignSystem
import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// What to do with the plant you just opened, and what the weather has been.
///
/// The three sources are fetched **concurrently and independently**, and each
/// failure is recorded rather than thrown. Tasks, suggestions and weather fail
/// for different reasons — a dead zone takes all three, a garden with no
/// coordinates takes only the last — and a card that went blank because one of
/// them was unreachable would tell a person less than one that shows what it
/// has and names what it is missing.
///
/// A standalone controller rather than more methods on `PlantDetailViewModel`,
/// following ``ObservationSuggestionController``'s precedent: the same block
/// belongs on any screen that shows one plant, and the detail view model is
/// already large.
@MainActor
@Observable
public final class PlantCareController {
    public private(set) var digest: PlantCareDigest?
    public private(set) var isLoading = false

    private let listProposals: ListGardenProposals?
    private let listTasks: ListGardenOutstandingTasks?
    private let getWeather: GetGardenWeather?
    private let strings: LocalizedStrings
    private let presentation: WeatherPresentation

    public init(
        listProposals: ListGardenProposals?,
        listTasks: ListGardenOutstandingTasks?,
        getWeather: GetGardenWeather?,
        strings: LocalizedStrings,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.listProposals = listProposals
        self.listTasks = listTasks
        self.getWeather = getWeather
        self.strings = strings
        self.presentation = WeatherPresentation(strings: strings, locale: locale)
    }

    // MARK: - Loading

    public func load(gardenId: String, plantId: String) async {
        isLoading = true
        defer { isLoading = false }

        async let tasks = fetch { try await self.listTasks?(gardenId: gardenId) }
        async let proposals = fetch { try await self.listProposals?(gardenId: gardenId) }
        async let weather = fetch { try await self.getWeather?(gardenId: gardenId) }

        let (loadedTasks, loadedProposals, loadedWeather) = await (tasks, proposals, weather)

        digest = PlantCareDigests.assemble(
            plantId: plantId,
            tasks: loadedTasks ?? [],
            recommendations: loadedProposals ?? [],
            weather: loadedWeather,
            conditionsUnknown: loadedWeather == nil,
            proposalsUnknown: loadedProposals == nil
        )
    }

    /// A failed read becomes `nil`, which the digest reports as "unknown".
    /// Silence would be a lie here: an empty action list and an unreachable
    /// server are opposite statements about the same plant.
    private func fetch<Value>(_ work: () async throws -> Value?) async -> Value? {
        do {
            return try await work()
        } catch {
            return nil
        }
    }

    // MARK: - Text

    public var title: String { strings(.careTitle) }
    public var nothingToDoTitle: String { strings(.careNothingToDo) }
    public var nothingToDoDetail: String { strings(.careNothingToDoDetail) }
    public var proposalsUnknownText: String { strings(.careProposalsUnknown) }
    public var conditionsTitle: String { strings(.weatherTitle) }
    public var conditionsUnknownText: String { strings(.weatherOffline) }
    public var rainfallNoneText: String { strings(.weatherRainfallNone) }
    public var rainfallDryText: String { strings(.weatherRainfallDry) }
    public var gardenRainfallNote: String { strings(.careGardenRainfallNote) }
    public var staleLabel: String { strings(.weatherStale) }
    public var staleExplanation: String { strings(.weatherStaleExplanation) }

    public func originLabel(_ origin: PlantCareAction.Origin) -> String {
        switch origin {
        case .task: strings(.careOriginTask)
        case .recommendation: strings(.careOriginRecommendation)
        }
    }

    public func originSymbol(_ origin: PlantCareAction.Origin) -> String {
        switch origin {
        // A decided thing and a proposed one are different shapes, not just
        // different words: the difference has to survive a glance.
        case .task: "checkmark.circle"
        case .recommendation: "lightbulb"
        }
    }

    /// Urgency is the one thing on this card that changes what you do next, so
    /// it is the one thing that carries colour. `low` and `normal` stay neutral
    /// — a garden where everything is coloured has nothing highlighted.
    public func tone(for urgency: TaskUrgency) -> Tone {
        switch urgency {
        case .low, .normal: .neutral
        case .high: .warning
        case .urgent: .negative
        }
    }

    public func dueText(_ date: Date) -> String {
        strings.string(.careDueBy, parameters: ["time": presentation.instantText(date)])
    }

    public var unavailableText: String {
        presentation.unavailableText(digest?.weatherUnavailableReason)
    }

    public func measurementCells(_ reading: GardenWeatherReading) -> [ReadingCell] {
        presentation.measurements(for: reading).map { measurement in
            ReadingCell(
                id: measurement.label,
                symbol: measurement.symbol,
                label: measurement.label,
                value: measurement.value,
                isMissing: measurement.isMissing
            )
        }
    }

    public func rainfallBars(_ rainfall: RecentRainfall) -> [RainfallBar] {
        presentation.rainfallDays(rainfall).map { day in
            RainfallBar(
                id: day.id,
                dayLabel: day.dayLabel,
                spokenValue: day.spokenValue,
                fillFraction: day.fillFraction,
                isDry: day.isDry
            )
        }
    }

    public func rainfallTitle(_ rainfall: RecentRainfall) -> String {
        presentation.rainfallTitle(rainfall)
    }

    public func rainfallTotal(_ rainfall: RecentRainfall) -> String {
        presentation.rainfallTotal(rainfall)
    }

    /// The chart's own accessible summary: the window and the total, which is
    /// the pair a decision is actually made on.
    public func rainfallSummary(_ rainfall: RecentRainfall) -> String {
        "\(presentation.rainfallTitle(rainfall)). \(presentation.rainfallTotal(rainfall))"
    }
}
