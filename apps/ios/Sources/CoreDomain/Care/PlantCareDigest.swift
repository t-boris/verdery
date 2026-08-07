import Foundation

/// One thing that wants doing to a plant, whatever produced it.
///
/// Tasks and recommendations arrive from different places and mean different
/// things — a task is something somebody decided, a recommendation is something
/// a rule proposes — but to a person standing in front of the plant they are
/// the same question: is there anything to do here? So they are shown together
/// and their origin is carried rather than erased, because acting on them
/// differs (a task is completed, a recommendation is accepted or dismissed).
public struct PlantCareAction: Sendable, Equatable, Identifiable {
    public enum Origin: Sendable, Equatable {
        /// Somebody planned it, or accepted a recommendation into it.
        case task
        /// A rule proposed it and nobody has decided yet.
        case recommendation
    }

    public let id: String
    public let origin: Origin
    public let title: String
    /// For a recommendation this is the rule's own stored explanation,
    /// rendered at generation time against the facts it actually fired on —
    /// which is precisely the "what is this plant missing" answer, stated by
    /// the thing that decided it rather than re-derived here.
    public let detail: String?
    public let urgency: TaskUrgency
    /// When it stops being worth doing, when that is known.
    public let dueBy: Date?

    public init(
        id: String,
        origin: Origin,
        title: String,
        detail: String?,
        urgency: TaskUrgency,
        dueBy: Date?
    ) {
        self.id = id
        self.origin = origin
        self.title = title
        self.detail = detail
        self.urgency = urgency
        self.dueBy = dueBy
    }
}

/// What is known about one plant's care, right now.
///
/// The answer to "I opened a plant — what do I do with it, how much rain has it
/// had, is it short of anything?" assembled entirely from records that already
/// exist: the tasks and recommendations that name this plant, and the garden's
/// stored conditions. Nothing here is inferred, and nothing is a new server
/// concept — which is why the whole thing is a pure function over values.
///
/// The three sources fail independently and are reported independently. Tasks
/// are offline-capable and rainfall is not, so a plant opened in a dead zone
/// still shows what wants doing while saying plainly that it cannot show the
/// weather. A digest that went blank because one of its three inputs was
/// unreachable would be worse than one that shows two thirds and says so.
public struct PlantCareDigest: Sendable, Equatable {
    public let plantId: String
    /// Most urgent first, then soonest due. Recommendations and tasks
    /// interleave, because urgency is the question and origin is not.
    public let actions: [PlantCareAction]
    /// The garden's rainfall, *not* this plant's. Nobody measures rain per
    /// plant, and a number presented as this plant's own would be a claim the
    /// data cannot support — a plant under a canopy or in a greenhouse got a
    /// different amount. It is shown because it is what the watering rule read.
    public let rainfall: RecentRainfall?
    public let conditions: GardenWeatherReading?
    public let forecast: GardenWeatherReading?
    public let attributionText: String?
    public let weatherUnavailableReason: WeatherUnavailableReason?
    /// True when the conditions could not be read at all — offline, or the
    /// request failed. Distinct from ``weatherUnavailableReason``, which is the
    /// server saying it has nothing: "we could not ask" and "there is nothing
    /// to give" lead to different next steps.
    public let conditionsUnknown: Bool
    /// True when the recommendation set could not be read. Recommendations are
    /// structurally online-only, so this is the ordinary offline state rather
    /// than a fault.
    public let proposalsUnknown: Bool

    public init(
        plantId: String,
        actions: [PlantCareAction],
        rainfall: RecentRainfall?,
        conditions: GardenWeatherReading?,
        forecast: GardenWeatherReading?,
        attributionText: String?,
        weatherUnavailableReason: WeatherUnavailableReason?,
        conditionsUnknown: Bool,
        proposalsUnknown: Bool
    ) {
        self.plantId = plantId
        self.actions = actions
        self.rainfall = rainfall
        self.conditions = conditions
        self.forecast = forecast
        self.attributionText = attributionText
        self.weatherUnavailableReason = weatherUnavailableReason
        self.conditionsUnknown = conditionsUnknown
        self.proposalsUnknown = proposalsUnknown
    }

    /// Nothing wants doing **and** we looked everywhere. An empty list while a
    /// source is unreachable is not the same statement, and the screen says a
    /// different sentence for each.
    public var isSettled: Bool { actions.isEmpty && !proposalsUnknown }

    /// Whether there is a conditions block worth drawing at all.
    public var hasConditions: Bool {
        conditions != nil || forecast != nil || rainfall != nil
    }
}

/// Assembling a plant's care digest from records that already exist.
public enum PlantCareDigests {
    /// Urgency descending. `TaskUrgency` is a closed ordered vocabulary, and
    /// its declaration order is low → urgent, so rank is derived rather than
    /// tabulated: adding a level cannot leave a stale table behind.
    private static func rank(_ urgency: TaskUrgency) -> Int {
        TaskUrgency.allCases.firstIndex(of: urgency) ?? 0
    }

    /// Only these two are outstanding. A completed, skipped, dismissed or
    /// deleted task is history, and history belongs in the journal rather than
    /// in a list headed "what to do".
    private static let outstandingStatuses: Set<TaskStatus> = [.planned, .suggested]

    /// Only these two are undecided. Anything else has already been acted on,
    /// and re-offering a decision somebody made reads as the application having
    /// forgotten.
    private static let undecidedStates: Set<RecommendationState> = [.eligible, .presented]

    public static func assemble(
        plantId: String,
        tasks: [GardenTask],
        recommendations: [TodayRecommendation],
        weather: GardenWeather?,
        conditionsUnknown: Bool,
        proposalsUnknown: Bool
    ) -> PlantCareDigest {
        let taskActions = tasks
            .filter { $0.targetPlantId == plantId && outstandingStatuses.contains($0.status) }
            .map { task in
                PlantCareAction(
                    id: task.id,
                    origin: .task,
                    title: task.title,
                    detail: task.notes,
                    urgency: task.urgency,
                    dueBy: task.timeWindowEnd
                )
            }

        let proposedActions = recommendations
            .filter {
                $0.recommendation.targetPlantId == plantId
                    && undecidedStates.contains($0.recommendation.state)
            }
            .map { item in
                PlantCareAction(
                    id: item.recommendation.id,
                    origin: .recommendation,
                    title: item.actionTitle,
                    detail: item.recommendation.explanation,
                    urgency: item.recommendation.urgency,
                    dueBy: item.recommendation.windowEnd
                )
            }

        // A recommendation accepted into a task appears as both until the
        // recommendation's own state catches up. The task is the decided one,
        // so it wins, and the proposal is dropped rather than shown twice.
        let plannedTitles = Set(taskActions.map(\.title))
        let actions = (taskActions + proposedActions.filter { !plannedTitles.contains($0.title) })
            .sorted { left, right in
                let leftRank = rank(left.urgency)
                let rightRank = rank(right.urgency)
                if leftRank != rightRank { return leftRank > rightRank }
                switch (left.dueBy, right.dueBy) {
                case let (lhs?, rhs?) where lhs != rhs: return lhs < rhs
                // A deadline outranks no deadline at equal urgency: a thing
                // with a closing window is the thing that can be missed.
                case (nil, .some): return false
                case (.some, nil): return true
                default: break
                }
                // Then a decided thing before a proposed one. Somebody
                // committed to the task; the suggestion is still a question,
                // and answering questions is not the first job in a garden.
                if left.origin != right.origin { return left.origin == .task }
                return left.id < right.id
            }

        return PlantCareDigest(
            plantId: plantId,
            actions: actions,
            rainfall: weather?.recentRainfall,
            conditions: weather?.observation,
            forecast: weather?.forecast,
            attributionText: weather?.attributionText,
            weatherUnavailableReason: weather?.unavailableReason,
            conditionsUnknown: conditionsUnknown,
            proposalsUnknown: proposalsUnknown
        )
    }
}
