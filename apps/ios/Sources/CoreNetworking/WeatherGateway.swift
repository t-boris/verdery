import CoreDomain
import CoreObservability
import Foundation

/// The conditions over a garden.
///
/// A pure read of what the scheduled refresh sweep already fetched: this
/// operation never calls the provider, so it spends no quota, cannot fail
/// because a provider is down, and has no latency coupling to a third party.
/// Requires only `viewGarden` — weather is garden context, readable by anyone
/// who can read the garden.
public protocol WeatherGateway: Sendable {
    func getGardenWeather(gardenId: String) async throws -> GardenWeather
}

struct GardenWeatherReadingTransport: Decodable {
    let effectiveAt: Date
    let retrievedAt: Date
    let freshness: String
    let temperatureCelsius: Double?
    let precipitationMm: Double?
    let windSpeedMps: Double?
    let humidityPercent: Double?

    /// An unrecognised freshness decodes as `stale` rather than throwing.
    /// Under-claiming is the safe direction: a reading wrongly labelled current
    /// is acted on, one wrongly labelled old is merely read with care.
    var domainValue: GardenWeatherReading {
        GardenWeatherReading(
            effectiveAt: effectiveAt,
            retrievedAt: retrievedAt,
            freshness: WeatherFreshness(rawValue: freshness) ?? .stale,
            temperatureCelsius: temperatureCelsius,
            precipitationMm: precipitationMm,
            windSpeedMps: windSpeedMps,
            humidityPercent: humidityPercent
        )
    }
}

struct DailyRainfallTransport: Decodable {
    let date: String
    let precipitationMm: Double

    var domainValue: DailyRainfall {
        DailyRainfall(date: date, precipitationMm: precipitationMm)
    }
}

struct RecentRainfallTransport: Decodable {
    let windowDays: Int
    let totalMm: Double
    let days: [DailyRainfallTransport]

    var domainValue: RecentRainfall {
        RecentRainfall(
            windowDays: windowDays,
            totalMm: totalMm,
            days: days.map(\.domainValue)
        )
    }
}

struct GardenWeatherTransport: Decodable {
    let observation: GardenWeatherReadingTransport?
    let forecast: GardenWeatherReadingTransport?
    let providerConfigured: Bool
    let attributionText: String?
    let recentRainfall: RecentRainfallTransport?
    let unavailableReason: String?

    /// An unrecognised reason decodes to `nil` rather than throwing. The screen
    /// then falls back to its generic "no readings yet" sentence, which is true
    /// of every reason and so cannot mislead.
    var domainValue: GardenWeather {
        GardenWeather(
            observation: observation?.domainValue,
            forecast: forecast?.domainValue,
            providerConfigured: providerConfigured,
            attributionText: attributionText,
            recentRainfall: recentRainfall?.domainValue,
            unavailableReason: unavailableReason.flatMap(WeatherUnavailableReason.init(rawValue:))
        )
    }
}

public struct URLSessionWeatherGateway: WeatherGateway {
    private let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        authTokenProvider: any AuthTokenProvider,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil,
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            authTokenProvider: authTokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
    }

    public func getGardenWeather(gardenId: String) async throws -> GardenWeather {
        let response: GardenWeatherTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/weather",
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }
}
