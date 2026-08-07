import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Request construction and response decoding for the garden's stored weather.
///
/// The decoding assertions matter more than usual here because every field is
/// nullable by contract and the client must not turn an absent measurement into
/// a zero one — for precipitation, that is the difference between "we do not
/// know whether it rained" and "it did not rain".
@Suite("Weather gateway")
struct WeatherGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer)
        -> URLSessionWeatherGateway
    {
        StubURLProtocol.register(answer, forSession: identifier)
        return URLSessionWeatherGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedWeatherCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeWeatherAuthTokenProvider(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private static let full = #"""
    {"observation":{"effectiveAt":"2026-08-07T09:00:00.000Z","retrievedAt":"2026-08-07T09:05:00.000Z",
      "freshness":"fresh","temperatureCelsius":18.4,"precipitationMm":0,"windSpeedMps":3.2,
      "humidityPercent":61},
     "forecast":{"effectiveAt":"2026-08-07T15:00:00.000Z","retrievedAt":"2026-08-07T09:05:00.000Z",
      "freshness":"stale","temperatureCelsius":21,"precipitationMm":null,"windSpeedMps":null,
      "humidityPercent":null},
     "providerConfigured":true,"attributionText":"Weather data by Open-Meteo.com",
     "recentRainfall":{"windowDays":7,"totalMm":6.2,
      "days":[{"date":"2026-08-05","precipitationMm":0},{"date":"2026-08-06","precipitationMm":6.2}]},
     "unavailableReason":null}
    """#

    private static let unavailable = #"""
    {"observation":null,"forecast":null,"providerConfigured":true,"attributionText":null,
     "recentRainfall":null,"unavailableReason":"gardenNotGeoreferenced"}
    """#

    @Test("GETs the garden's weather and decodes every reading")
    func decodesFullResult() async throws {
        let identifier = "weather-full"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.full))

        let weather = try await gateway.getGardenWeather(gardenId: "garden-1")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/v1/gardens/garden-1/weather")

        #expect(weather.observation?.temperatureCelsius == 18.4)
        // Zero survives as zero. A measured dry hour is a measurement.
        #expect(weather.observation?.precipitationMm == 0)
        #expect(weather.observation?.freshness == .fresh)
        #expect(weather.forecast?.isStale == true)
        // Absent stays absent rather than becoming zero.
        #expect(weather.forecast?.precipitationMm == nil)
        #expect(weather.forecast?.windSpeedMps == nil)
        #expect(weather.attributionText == "Weather data by Open-Meteo.com")
        #expect(weather.recentRainfall?.windowDays == 7)
        #expect(weather.recentRainfall?.days.map(\.date) == ["2026-08-05", "2026-08-06"])
        #expect(weather.unavailableReason == nil)
        #expect(weather.hasReading)
    }

    /// "No reading yet" is an ordinary state of a garden that was just created,
    /// not an error, and it arrives as a 200 with a typed reason.
    @Test("decodes an empty result with its reason")
    func decodesUnavailable() async throws {
        let identifier = "weather-unavailable"
        defer { StubURLProtocol.unregister(identifier) }
        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.unavailable))

        let weather = try await gateway.getGardenWeather(gardenId: "garden-1")

        #expect(!weather.hasReading)
        #expect(weather.unavailableReason == .gardenNotGeoreferenced)
        // `nil` rainfall means UNKNOWN, never "no rain fell".
        #expect(weather.recentRainfall == nil)
    }

    /// Under-claiming is the safe direction. A reading wrongly labelled current
    /// gets acted on; one wrongly labelled old is merely read with care.
    @Test("treats an unrecognised freshness as stale and an unknown reason as none")
    func toleratesUnknownVocabulary() async throws {
        let identifier = "weather-unknown"
        defer { StubURLProtocol.unregister(identifier) }
        let body = #"""
        {"observation":{"effectiveAt":"2026-08-07T09:00:00.000Z",
          "retrievedAt":"2026-08-07T09:05:00.000Z","freshness":"whenever","temperatureCelsius":18,
          "precipitationMm":null,"windSpeedMps":null,"humidityPercent":null},
         "forecast":null,"providerConfigured":true,"attributionText":"x","recentRainfall":null,
         "unavailableReason":"somethingNewOnTheServer"}
        """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, body))

        let weather = try await gateway.getGardenWeather(gardenId: "garden-1")

        #expect(weather.observation?.freshness == .stale)
        #expect(weather.unavailableReason == nil)
    }
}

private struct FixedWeatherCorrelationIdentifierProvider: CorrelationIdentifierProvider {
    let value: String

    func next() -> CorrelationIdentifier {
        CorrelationIdentifier(value: value)
    }
}

private struct FakeWeatherAuthTokenProvider: AuthTokenProvider {
    let token: String?

    func currentIdToken() async throws -> String? { token }
}
