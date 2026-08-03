import CoreDomain
import CoreLocalization
import Foundation
import Testing

@testable import FeatureObservations

/// The journal sequence's reading side (P11-MEDIA-01): what it asks the server
/// for, and what it does when a frame's signed URL will not resolve.
@Suite("Plant journal")
@MainActor
struct PlantJournalViewModelTests {
    private func frame(
        _ mediaId: String,
        purpose: ObservationPhotoPurpose?,
        month: Int
    ) -> PlantJournalFrame {
        PlantJournalFrame(
            observationId: "obs-\(mediaId)",
            mediaId: mediaId,
            observedAt: Date(timeIntervalSince1970: TimeInterval(month) * 2_592_000),
            purpose: purpose
        )
    }

    private func makeModel(
        gateway: FakeObservationGateway,
        mediaGateway: FakeObservationsMediaGateway
    ) -> PlantJournalViewModel {
        PlantJournalViewModel(
            gardenId: "garden-1",
            plantId: "plant-1",
            listPlantJournalFrames: ListPlantJournalFrames(gateway: gateway),
            mediaGateway: mediaGateway,
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("An unnarrowed load asks for every photograph, including unlabelled ones")
    func loadWithoutNarrowing() async throws {
        let gateway = FakeObservationGateway()
        gateway.journalFrames = [
            frame("media-1", purpose: .wholePlant, month: 1),
            frame("media-2", purpose: nil, month: 2),
        ]
        let media = FakeObservationsMediaGateway()
        media.accessById = [
            "media-1": MediaAccess(url: URL(string: "https://example.test/1")!, expiresAt: .now),
            "media-2": MediaAccess(url: URL(string: "https://example.test/2")!, expiresAt: .now),
        ]
        let model = makeModel(gateway: gateway, mediaGateway: media)

        await model.load()

        // A photograph carrying no purpose label appears only here — asking
        // for one narrows it away, and guessing which sequence it belongs to
        // would be inventing data.
        #expect(gateway.journalFrameRequests == [nil])
        #expect(model.frames.map(\.frame.mediaId) == ["media-1", "media-2"])
    }

    @Test("Choosing a purpose reloads the sequence narrowed to it")
    func narrowingReloads() async throws {
        let gateway = FakeObservationGateway()
        gateway.journalFrames = [
            frame("media-1", purpose: .wholePlant, month: 1),
            frame("media-2", purpose: .leafFront, month: 2),
        ]
        let media = FakeObservationsMediaGateway()
        media.accessById = [
            "media-2": MediaAccess(url: URL(string: "https://example.test/2")!, expiresAt: .now)
        ]
        let model = makeModel(gateway: gateway, mediaGateway: media)
        await model.load()

        model.purpose = .leafFront
        // The property's own observer starts the reload; awaiting a second
        // explicit load here is what makes the test deterministic rather than
        // dependent on that task's scheduling.
        await model.load()

        #expect(gateway.journalFrameRequests.last == .leafFront)
        #expect(model.frames.map(\.frame.mediaId) == ["media-2"])
    }

    @Test("A frame whose signed URL will not resolve is dropped, not the whole sequence")
    func unresolvableFrameIsDropped() async throws {
        let gateway = FakeObservationGateway()
        gateway.journalFrames = [
            frame("media-1", purpose: .wholePlant, month: 1),
            frame("media-2", purpose: .wholePlant, month: 2),
        ]
        let media = FakeObservationsMediaGateway()
        media.accessById = [
            "media-2": MediaAccess(url: URL(string: "https://example.test/2")!, expiresAt: .now)
        ]
        let model = makeModel(gateway: gateway, mediaGateway: media)

        await model.load()

        // One expired signature must not hide a decade of photographs.
        #expect(model.frames.map(\.frame.mediaId) == ["media-2"])
    }

    @Test("A failed read shows nothing rather than a stale sequence")
    func failedReadClearsFrames() async throws {
        let gateway = FakeObservationGateway()
        gateway.journalFrames = [frame("media-1", purpose: .wholePlant, month: 1)]
        let media = FakeObservationsMediaGateway()
        media.accessById = [
            "media-1": MediaAccess(url: URL(string: "https://example.test/1")!, expiresAt: .now)
        ]
        let model = makeModel(gateway: gateway, mediaGateway: media)
        await model.load()
        #expect(model.frames.count == 1)

        gateway.nextJournalFailure = FakeObservationsMediaGateway.FakeError.unconfigured
        await model.load()

        #expect(model.frames.isEmpty)
    }

    @Test("The empty message names the filter when one is set")
    func emptyMessageDistinguishesFilter() {
        let model = makeModel(
            gateway: FakeObservationGateway(), mediaGateway: FakeObservationsMediaGateway()
        )

        let unnarrowed = model.emptyMessage
        model.purpose = .fruit

        // "No photographs at all" and "none of this kind" are different
        // situations; the second is one the reader can undo.
        #expect(model.emptyMessage != unnarrowed)
    }
}
