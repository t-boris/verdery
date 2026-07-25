import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the media gateway's read-side wire shape directly against
/// `packages/api-contracts/openapi.yaml` (P6-PLAN iOS parity):
/// `ListGardenMedia` — path, query filter, pagination — and the
/// `Media.derivatives` array both list and status responses now embed.
/// This app hand-writes its own networking, so nothing else checks that
/// this gateway actually speaks the contract.
@Suite("Media gateway")
struct MediaGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    // Local copies of the tiny per-file fakes every gateway test file in
    // this target declares privately (`GardenGatewayTests` et al.).
    private struct FixedCorrelation: CorrelationIdentifierProvider {
        let value: String
        func next() -> CorrelationIdentifier { CorrelationIdentifier(value: value) }
    }

    private struct FixedAuthToken: AuthTokenProvider {
        let token: String?
        func currentIdToken() async throws -> String? { token }
    }

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionMediaGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionMediaGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelation(value: identifier),
            authTokenProvider: FixedAuthToken(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private static let planJSON = #"""
        {
          "id": "media-plan-1",
          "gardenId": "garden-1",
          "uploadedByProfileId": "profile-1",
          "mediaClass": "imported_plan",
          "displayFilename": "plan.png",
          "declaredContentType": "image/png",
          "verifiedContentType": "image/png",
          "declaredByteSize": 2048,
          "verifiedByteSize": 2048,
          "checksumSha256": null,
          "uploadState": "available",
          "processingState": "processed",
          "sensitivityClassification": "sensitive",
          "derivatives": [
            {"derivativeKind": "thumbnail", "mediaId": "media-thumb-1"},
            {"derivativeKind": "screen_preview", "mediaId": "media-preview-1"},
            {"derivativeKind": "high_resolution", "mediaId": "media-high-1"}
          ],
          "revision": 4,
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-02T00:00:00.000Z"
        }
        """#

    @Test("listGardenMedia requests the garden media path with class filter and pagination")
    func listBuildsPathAndDecodes() async throws {
        let identifier = "list-garden-media"
        defer { StubURLProtocol.unregister(identifier) }

        let body = #"{"items": [\#(Self.planJSON)], "nextCursor": "cursor-2"}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, body))

        let result = try await gateway.listGardenMedia(
            gardenId: "garden-1",
            mediaClass: .importedPlan,
            cursor: nil,
            limit: 50
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/media")
        #expect(request.url?.query == "mediaClass=imported_plan&limit=50")
        #expect(request.httpMethod == "GET")

        #expect(result.nextCursor == "cursor-2")
        let media = try #require(result.items.first)
        #expect(media.id == "media-plan-1")
        #expect(media.mediaClass == .importedPlan)
        #expect(media.processingState == .processed)
        #expect(media.derivatives.count == 3)
        // The display preference: the screen preview, never the original
        // and never the high-resolution review image.
        #expect(media.displayDerivative?.derivativeKind == .screenPreview)
        #expect(media.displayDerivative?.mediaId == "media-preview-1")
    }

    @Test("listGardenMedia forwards the continuation cursor")
    func listForwardsCursor() async throws {
        let identifier = "list-garden-media-cursor"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, #"{"items": []}"#))
        let result = try await gateway.listGardenMedia(
            gardenId: "garden-1",
            mediaClass: nil,
            cursor: "cursor-2",
            limit: nil
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.query == "cursor=cursor-2")
        #expect(result.items.isEmpty)
        #expect(result.nextCursor == nil)
    }

    @Test("getMediaStatus decodes the embedded derivatives array")
    func statusDecodesDerivatives() async throws {
        let identifier = "media-status-derivatives"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.planJSON))
        let media = try await gateway.getMediaStatus(gardenId: "garden-1", mediaId: "media-plan-1")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/media/media-plan-1")
        #expect(media.derivatives.map(\.derivativeKind) == [.thumbnail, .screenPreview, .highResolution])
    }

    @Test("A write-path response without derivatives decodes to an empty array")
    func absentDerivativesDecodeEmpty() async throws {
        let identifier = "media-status-no-derivatives"
        defer { StubURLProtocol.unregister(identifier) }

        // The write-path `Media` shape: no `derivatives` member at all.
        let body = #"""
            {
              "id": "media-plan-1",
              "gardenId": "garden-1",
              "uploadedByProfileId": "profile-1",
              "mediaClass": "imported_plan",
              "displayFilename": "plan.pdf",
              "declaredContentType": "application/pdf",
              "verifiedContentType": null,
              "declaredByteSize": 2048,
              "verifiedByteSize": null,
              "checksumSha256": null,
              "uploadState": "authorized",
              "processingState": null,
              "sensitivityClassification": "sensitive",
              "revision": 1,
              "createdAt": "2026-01-01T00:00:00.000Z",
              "updatedAt": "2026-01-01T00:00:00.000Z"
            }
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, body))
        let media = try await gateway.getMediaStatus(gardenId: "garden-1", mediaId: "media-plan-1")

        #expect(media.derivatives.isEmpty)
        #expect(media.displayDerivative == nil)
    }
}
