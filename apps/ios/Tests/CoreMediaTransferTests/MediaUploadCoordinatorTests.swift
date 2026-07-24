import CoreDomain
import CoreNetworking
import Foundation
import GRDB
import Testing

@testable import CoreMediaTransfer
@testable import CorePersistence

@Suite("MediaUploadCoordinator", .serialized)
struct MediaUploadCoordinatorTests {
    private func makeTransferStore() throws -> GRDBMediaTransferStore {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return GRDBMediaTransferStore(dbQueue: dbQueue)
    }

    private func makeCoordinator(
        transferStore: any MediaTransferStore,
        gateway: FakeMediaGateway,
        transport: FakeBackgroundUploadTransport,
        now: @escaping @Sendable () -> Date = { Date(timeIntervalSince1970: 1_000_000) },
        generateId: @escaping @Sendable () -> String = { "local-1" }
    ) -> MediaUploadCoordinator {
        MediaUploadCoordinator(
            fileStore: FileManagerLocalMediaFileStore(),
            transferStore: transferStore,
            gateway: gateway,
            uploadTransport: transport,
            now: now,
            generateId: generateId,
            randomUnitInterval: { 0 },
            maxProcessingPollAttempts: 2,
            sleep: { _ in }
        )
    }

    /// Polls `condition` until it is `true` or `timeout` elapses — needed
    /// because `enqueue`'s registration/upload pipeline runs on a detached,
    /// fire-and-forget `Task`, not synchronously within the caller's own
    /// `await`.
    private func waitUntil(timeout: TimeInterval = 2, _ condition: @Sendable () async -> Bool) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return }
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    private func cleanUp(profileId: String) {
        guard let base = try? LocalDatabase.applicationSupportDirectory() else { return }
        let directory = base.appendingPathComponent("profiles/\(profileId)/media", isDirectory: true)
        try? FileManager.default.removeItem(at: directory)
    }

    // MARK: - Local durability

    @Test("enqueue durably writes the file and a captured row before any network call")
    func enqueueIsDurableBeforeNetwork() async throws {
        let profileId = "durability-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        let store = try makeTransferStore()
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport)

        let data = Data("a real photo".utf8)
        let transfer = try await coordinator.enqueue(
            data: data,
            gardenId: "garden-1",
            profileId: profileId,
            mediaClass: .gardenPhoto,
            displayFilename: "photo.jpg",
            contentType: "image/jpeg"
        )

        // Returned synchronously, before the fire-and-forget registration
        // task could possibly have run — proves the durability write and
        // the row commit both happen before any network call is even
        // attempted.
        #expect(transfer.state == .captured)
        #expect(transfer.byteCount == Int64(data.count))
        #expect(transfer.declaredByteSize == Int64(data.count))

        let fileURL = try #require(URL(string: transfer.localFileUrl))
        #expect(FileManager.default.fileExists(atPath: fileURL.path))
        #expect(try Data(contentsOf: fileURL) == data)

        let persisted = try await store.fetch(id: transfer.id)
        #expect(persisted == transfer)
    }

    // MARK: - Happy path

    @Test("a full successful upload reaches .retained with the server mediaId, with no processing step")
    func happyPathReachesRetained() async throws {
        let profileId = "happy-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        let store = try makeTransferStore()
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport)
        await coordinator.start()

        await gateway.setRegisterHandler { _ in .success(.fixture(mediaId: "media-42", revision: 1)) }
        await gateway.setCompleteHandler { _ in .success(.fixture(id: "media-42", uploadState: .available, processingState: nil, revision: 2)) }

        let data = Data(repeating: 0x41, count: 100)
        _ = try await coordinator.enqueue(
            data: data,
            gardenId: "garden-1",
            profileId: profileId,
            mediaClass: .gardenPhoto,
            displayFilename: "photo.jpg",
            contentType: "image/jpeg"
        )

        await waitUntil { await transport.startUploadCalls.count == 1 }
        let call = await transport.startUploadCalls[0]
        #expect(call.transferId == "local-1")
        #expect(call.contentRange == "bytes 0-99/100")

        await transport.emit(.finished(transferId: "local-1", statusCode: 200, rangeHeader: nil, transportFailureCode: nil))

        await waitUntil { (try? await store.fetch(id: "local-1"))??.state == .retained }
        let final = try #require(try await store.fetch(id: "local-1"))
        #expect(final.state == .retained)
        #expect(final.mediaId == "media-42")
        #expect(final.serverUploadState == "available")
        #expect(PhotoAttachmentStatus.from(final) == .ready(mediaId: "media-42"))

        let completeCalls = await gateway.completeCalls
        #expect(completeCalls.count == 1)
        #expect(completeCalls[0].expectedRevision == 1)
    }

    @Test("a rejected completion is a terminal, non-retryable failure")
    func rejectedCompletionIsTerminal() async throws {
        let profileId = "rejected-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        let store = try makeTransferStore()
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport)
        await coordinator.start()

        await gateway.setRegisterHandler { _ in .success(.fixture(mediaId: "media-1")) }
        await gateway.setCompleteHandler { _ in .success(.fixture(id: "media-1", uploadState: .rejected)) }

        _ = try await coordinator.enqueue(
            data: Data(repeating: 1, count: 10),
            gardenId: "garden-1",
            profileId: profileId,
            mediaClass: .gardenPhoto,
            displayFilename: "photo.jpg",
            contentType: "image/jpeg"
        )

        await waitUntil { await transport.startUploadCalls.count == 1 }
        await transport.emit(.finished(transferId: "local-1", statusCode: 200, rangeHeader: nil, transportFailureCode: nil))

        await waitUntil { (try? await store.fetch(id: "local-1"))??.state == .failed }
        let final = try #require(try await store.fetch(id: "local-1"))
        #expect(PhotoAttachmentStatus.from(final) == .rejected(reasonCode: "media.upload.rejected"))
        #expect(!PhotoAttachmentStatus.from(final).isRetryable)
    }

    // MARK: - Retry-category gating

    @Test("an authorization failure is not automatically retried, but an explicit retry attempts again")
    func authorizationFailureNeedsExplicitRetry() async throws {
        let profileId = "auth-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        let store = try makeTransferStore()
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport)
        await coordinator.start()

        let forbiddenBody = APIErrorBody(code: "auth.forbidden", message: "forbidden", correlationId: "c-1", retryable: false)
        await gateway.setRegisterHandler { _ in .failure(APIGatewayError.service(forbiddenBody, statusCode: 403, retryAfterSeconds: nil)) }

        _ = try await coordinator.enqueue(
            data: Data(repeating: 1, count: 10),
            gardenId: "garden-1",
            profileId: profileId,
            mediaClass: .gardenPhoto,
            displayFilename: "photo.jpg",
            contentType: "image/jpeg"
        )

        await waitUntil { (try? await store.fetch(id: "local-1"))??.state == .failed }
        var transfer = try #require(try await store.fetch(id: "local-1"))
        #expect(transfer.retryState.lastErrorCategory == .authorization)
        #expect(PhotoAttachmentStatus.from(transfer).isRetryable)

        // A second automatic drive attempt must NOT re-call the gateway —
        // the category gate excludes it, mirroring `RemoteSyncEngine
        // .eligiblePending`'s identical exclusion.
        let registerCallsBeforeAutomaticAttempt = await gateway.registerCalls.count
        await coordinator.driveUpload(transferId: "local-1", bypassingAutomaticRetryGate: false)
        #expect(await gateway.registerCalls.count == registerCallsBeforeAutomaticAttempt)

        // Fix the underlying cause and retry explicitly.
        await gateway.setRegisterHandler { _ in .success(.fixture(mediaId: "media-9")) }
        await coordinator.retry(transferId: "local-1")

        await waitUntil { await transport.startUploadCalls.count == 1 }
        transfer = try #require(try await store.fetch(id: "local-1"))
        #expect(transfer.mediaId == "media-9")
    }

    // MARK: - Session expiry

    @Test("an upload session that expired before the transfer finished is abandoned for a fresh one")
    func expiredSessionTriggersReRegistration() async throws {
        let profileId = "expired-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        let store = try makeTransferStore()
        let now = Date(timeIntervalSince1970: 1_000_000)
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport, now: { now })
        await coordinator.start()

        // The very first registration returns a session that is ALREADY
        // expired relative to `now` — simulating a resume attempt long
        // after the original 1-hour TTL elapsed.
        await gateway.setRegisterHandler { _, attemptNumber in
            let expiresAt = attemptNumber == 1 ? now.addingTimeInterval(-1) : now.addingTimeInterval(3600)
            return .success(MediaUploadSession(
                media: .fixture(id: "media-\(attemptNumber)"),
                uploadUrl: URL(string: "https://storage.googleapis.com/upload/media-\(attemptNumber)")!,
                uploadUrlExpiresAt: expiresAt
            ))
        }

        _ = try await coordinator.enqueue(
            data: Data(repeating: 1, count: 10),
            gardenId: "garden-1",
            profileId: profileId,
            mediaClass: .gardenPhoto,
            displayFilename: "photo.jpg",
            contentType: "image/jpeg"
        )

        await waitUntil { await transport.startUploadCalls.count == 1 }
        let call = await transport.startUploadCalls[0]
        // Uploaded against the SECOND (fresh) session's URL, never the
        // first, already-expired one.
        #expect(call.url.absoluteString.hasSuffix("media-2"))

        let registerCalls = await gateway.registerCalls
        #expect(registerCalls.count == 2)
        #expect(registerCalls[0].idempotencyKey != registerCalls[1].idempotencyKey)

        let transfer = try #require(try await store.fetch(id: "local-1"))
        #expect(transfer.mediaId == "media-2")
    }

    // MARK: - Recovery after relaunch

    @Test("recovery drives a captured-but-never-registered transfer forward after a simulated relaunch")
    func recoveryDrivesUnregisteredTransferForward() async throws {
        let profileId = "recovery-captured-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let store = try makeTransferStore()
        let fileStore = FileManagerLocalMediaFileStore()
        let fileURL = try fileStore.write(Data(repeating: 1, count: 10), localId: "orphan-1", profileId: profileId, fileExtension: "jpg")
        defer { try? fileStore.delete(at: fileURL) }

        let timestamp = Date(timeIntervalSince1970: 500)
        try await store.save(
            MediaTransfer(
                id: "orphan-1",
                gardenId: "garden-1",
                localFileUrl: fileURL.absoluteString,
                byteCount: 10,
                state: .captured,
                createdAt: timestamp,
                updatedAt: timestamp,
                mediaClass: .gardenPhoto,
                displayFilename: "photo.jpg",
                declaredContentType: "image/jpeg",
                declaredByteSize: 10
            )
        )

        // A fresh coordinator instance — as if the app relaunched — with
        // fresh fakes that know nothing about the row above.
        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        await gateway.setRegisterHandler { _ in .success(.fixture(mediaId: "media-recovered")) }
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport)

        await coordinator.start()

        await waitUntil { await transport.startUploadCalls.count == 1 }
        let transfer = try #require(try await store.fetch(id: "orphan-1"))
        #expect(transfer.mediaId == "media-recovered")
    }

    @Test("recovery re-confirms completion for a transfer that finished uploading but never confirmed")
    func recoveryReconfirmsCompletion() async throws {
        let profileId = "recovery-verifying-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let store = try makeTransferStore()
        let fileStore = FileManagerLocalMediaFileStore()
        let fileURL = try fileStore.write(Data(repeating: 1, count: 10), localId: "verifying-1", profileId: profileId, fileExtension: "jpg")
        defer { try? fileStore.delete(at: fileURL) }

        let timestamp = Date(timeIntervalSince1970: 500)
        try await store.save(
            MediaTransfer(
                id: "verifying-1",
                gardenId: "garden-1",
                localFileUrl: fileURL.absoluteString,
                byteCount: 10,
                state: .verifying,
                createdAt: timestamp,
                updatedAt: timestamp,
                mediaClass: .gardenPhoto,
                displayFilename: "photo.jpg",
                declaredContentType: "image/jpeg",
                declaredByteSize: 10,
                mediaId: "media-verifying",
                uploadUrl: "https://storage.googleapis.com/upload/media-verifying",
                uploadUrlExpiresAt: Date(timeIntervalSince1970: 10_000_000),
                mediaRevision: 1
            )
        )

        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        await gateway.setCompleteHandler { _ in .success(.fixture(id: "media-verifying", uploadState: .available, revision: 2)) }
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport)

        await coordinator.start()

        await waitUntil { (try? await store.fetch(id: "verifying-1"))??.state == .retained }
        let completeCalls = await gateway.completeCalls
        #expect(completeCalls.count == 1)
        #expect(completeCalls[0].mediaId == "media-verifying")
    }

    @Test("recovery leaves an in-flight upload the OS still has alive untouched")
    func recoveryLeavesStillInFlightUploadUntouched() async throws {
        let profileId = "recovery-inflight-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let store = try makeTransferStore()
        let fileStore = FileManagerLocalMediaFileStore()
        let fileURL = try fileStore.write(Data(repeating: 1, count: 10), localId: "inflight-1", profileId: profileId, fileExtension: "jpg")
        defer { try? fileStore.delete(at: fileURL) }

        let timestamp = Date(timeIntervalSince1970: 500)
        try await store.save(
            MediaTransfer(
                id: "inflight-1",
                gardenId: "garden-1",
                localFileUrl: fileURL.absoluteString,
                byteCount: 10,
                state: .uploading,
                createdAt: timestamp,
                updatedAt: timestamp,
                mediaClass: .gardenPhoto,
                displayFilename: "photo.jpg",
                declaredContentType: "image/jpeg",
                declaredByteSize: 10,
                mediaId: "media-inflight",
                uploadUrl: "https://storage.googleapis.com/upload/media-inflight",
                uploadUrlExpiresAt: Date(timeIntervalSince1970: 10_000_000),
                mediaRevision: 1
            )
        )

        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        await transport.setTransferIdsStillInFlight(["inflight-1"])
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport)

        await coordinator.start()
        // Give any (incorrect) automatic resume attempt a moment to happen.
        try? await Task.sleep(nanoseconds: 50_000_000)

        // No status-check/complete/register call should have been made —
        // the transfer is left exactly as-is, awaiting the OS's own
        // eventual delivery of its result through `events`.
        #expect(await gateway.completeCalls.isEmpty)
        #expect(await gateway.registerCalls.isEmpty)
        #expect(await transport.startUploadCalls.isEmpty)

        let transfer = try #require(try await store.fetch(id: "inflight-1"))
        #expect(transfer.state == .uploading)
    }

    // MARK: - Discard

    @Test("discard removes both the local file and the row")
    func discardRemovesFileAndRow() async throws {
        let profileId = "discard-\(UUID().uuidString)"
        defer { cleanUp(profileId: profileId) }
        let gateway = FakeMediaGateway()
        let transport = FakeBackgroundUploadTransport()
        let store = try makeTransferStore()
        let coordinator = makeCoordinator(transferStore: store, gateway: gateway, transport: transport)

        let transfer = try await coordinator.enqueue(
            data: Data(repeating: 1, count: 10),
            gardenId: "garden-1",
            profileId: profileId,
            mediaClass: .gardenPhoto,
            displayFilename: "photo.jpg",
            contentType: "image/jpeg"
        )
        let fileURL = try #require(URL(string: transfer.localFileUrl))
        #expect(FileManager.default.fileExists(atPath: fileURL.path))

        await coordinator.discard(transferId: transfer.id)

        #expect(!FileManager.default.fileExists(atPath: fileURL.path))
        let afterDiscard = try await store.fetch(id: transfer.id)
        #expect(afterDiscard?.state == .deleted)
    }
}
