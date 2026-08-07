import Foundation

/// How old a reading is, judged against the per-kind refresh window.
///
/// Derived server-side at read time and never stored, because a stored
/// classification rots as wall-clock time passes.
public enum WeatherFreshness: String, Sendable, Equatable, Codable {
    case fresh
    case stale
}

/// One stored, provider-neutral weather record, in the single documented SI
/// profile: degrees Celsius, millimetres, metres per second, percent.
///
/// Every measurement is nullable and no absent one is ever substituted with a
/// default. A provider that does not report a field leaves it `nil` — the same
/// "missing facts remain missing" rule the recommendation engine applies to its
/// own inputs. For precipitation the distinction is the whole point: zero means
/// it did not rain, `nil` means nobody knows whether it did.
public struct GardenWeatherReading: Sendable, Equatable {
    /// The moment the reading is *about* — observation time for an observation,
    /// target time for a forecast. Not when it was fetched.
    public let effectiveAt: Date
    /// When it was fetched. This is the age ``freshness`` classifies.
    public let retrievedAt: Date
    public let freshness: WeatherFreshness
    public let temperatureCelsius: Double?
    /// Accumulated depth over a provider-defined interval, deliberately not
    /// normalized: no canonical interval exists to normalize to.
    public let precipitationMm: Double?
    public let windSpeedMps: Double?
    public let humidityPercent: Double?

    public init(
        effectiveAt: Date,
        retrievedAt: Date,
        freshness: WeatherFreshness,
        temperatureCelsius: Double?,
        precipitationMm: Double?,
        windSpeedMps: Double?,
        humidityPercent: Double?
    ) {
        self.effectiveAt = effectiveAt
        self.retrievedAt = retrievedAt
        self.freshness = freshness
        self.temperatureCelsius = temperatureCelsius
        self.precipitationMm = precipitationMm
        self.windSpeedMps = windSpeedMps
        self.humidityPercent = humidityPercent
    }

    public var isStale: Bool { freshness == .stale }
}

/// One elapsed day's rainfall total, exactly as the provider reported it.
public struct DailyRainfall: Sendable, Equatable, Identifiable {
    /// The day this total covers, in the garden's own stored effective time,
    /// as the contract's plain `"yyyy-MM-dd"` string — the same representation
    /// `GardenTask.dueDate` and `Plant.acquisitionDate` carry, and for the same
    /// reason: a calendar day is not an instant.
    public let date: String
    public let precipitationMm: Double

    public init(date: String, precipitationMm: Double) {
        self.date = date
        self.precipitationMm = precipitationMm
    }

    public var id: String { date }
    /// Measured, and nothing fell. Distinct from having no measurement at all.
    public var isDry: Bool { precipitationMm == 0 }
}

/// Elapsed daily rainfall over the recent window — the same series the watering
/// rule accumulates over, so what a person sees is what the engine decided on.
public struct RecentRainfall: Sendable, Equatable {
    public let windowDays: Int
    /// Sum across ``days``. Zero with an empty series means nothing was
    /// measured, **not** that no rain fell.
    public let totalMm: Double
    /// Oldest first. May be shorter than ``windowDays`` when the garden has
    /// less history than that.
    public let days: [DailyRainfall]

    public init(windowDays: Int, totalMm: Double, days: [DailyRainfall]) {
        self.windowDays = windowDays
        self.totalMm = totalMm
        self.days = days
    }

    /// The tallest day in the window, which is what bars are scaled against:
    /// the question a rainfall chart answers is "when did it rain", not "how
    /// does this garden compare with elsewhere".
    public var peakMm: Double { days.map(\.precipitationMm).max() ?? 0 }

    /// True only when there is a series *and* every day in it measured zero.
    /// An empty series is unknown, and unknown is not dry.
    public var isMeasuredDry: Bool { !days.isEmpty && totalMm == 0 }
}

/// Why no reading is available, when none is.
///
/// Three different answers, kept apart on purpose: one is a deployment fact
/// nobody using the application can act on, one is something the reader fixes
/// themselves, and one resolves on its own. Collapsing them into a single "no
/// weather" line would hide the only one that is actionable.
public enum WeatherUnavailableReason: String, Sendable, Equatable, Codable {
    /// The deployment names no active provider. No garden gets readings.
    case noProviderConfigured
    /// The garden has no coordinates, and coordinates *are* the request. The
    /// one reason the reader can resolve.
    case gardenNotGeoreferenced
    /// Provider and coordinates are both in place; the sweep has not reached
    /// this garden yet. Resolves on its own.
    case notYetFetched
}

/// The conditions over a garden: the latest stored observation, the nearest
/// forecast, and the elapsed rainfall series.
///
/// A pure read of what the scheduled refresh already fetched, so it spends no
/// provider quota and cannot fail because a provider is down. Every field
/// degrades honestly rather than erroring — an absent reading reports its
/// reason rather than leaving the client to infer one from emptiness.
public struct GardenWeather: Sendable, Equatable {
    public let observation: GardenWeatherReading?
    public let forecast: GardenWeatherReading?
    /// Whether this environment has an active provider at all. `false` is a
    /// configuration fact, not a garden fact, and the one case a client should
    /// not invite the person to fix.
    public let providerConfigured: Bool
    /// The exact credit line a client **must** render alongside any reading it
    /// displays — a licence obligation carried by the provider's own terms,
    /// snapshotted onto the record at fetch time.
    public let attributionText: String?
    /// `nil` means UNKNOWN, never "no rain fell".
    public let recentRainfall: RecentRainfall?
    public let unavailableReason: WeatherUnavailableReason?

    public init(
        observation: GardenWeatherReading?,
        forecast: GardenWeatherReading?,
        providerConfigured: Bool,
        attributionText: String?,
        recentRainfall: RecentRainfall?,
        unavailableReason: WeatherUnavailableReason?
    ) {
        self.observation = observation
        self.forecast = forecast
        self.providerConfigured = providerConfigured
        self.attributionText = attributionText
        self.recentRainfall = recentRainfall
        self.unavailableReason = unavailableReason
    }

    public var hasReading: Bool { observation != nil || forecast != nil }
}
