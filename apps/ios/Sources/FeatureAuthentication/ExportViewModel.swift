import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// Requesting a copy of your own data, and waiting for it.
@MainActor
@Observable
public final class ExportViewModel {
    public enum State: Equatable {
        case idle
        case submitting
        /// The server is building it. The client polls.
        case preparing(ExportRequest)
        case ready(ExportRequest, MediaAccess)
        case failed(message: String)
    }

    public private(set) var state: State = .idle
    public var scope: ExportScope = .account
    public var includeMedia: Bool = true

    private let gateway: any ExportGateway
    private let gardenId: String?
    private let strings: LocalizedStrings
    private let generateIdempotencyKey: @Sendable () -> String

    /// Generating a package is minutes of work, not seconds, so this is a
    /// gentle poll rather than a tight one — and the screen says it can be
    /// left, because it can.
    private static let pollInterval = Duration.seconds(5)

    public init(
        gateway: any ExportGateway,
        gardenId: String?,
        strings: LocalizedStrings,
        generateIdempotencyKey: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.gateway = gateway
        self.gardenId = gardenId
        self.strings = strings
        self.generateIdempotencyKey = generateIdempotencyKey
    }

    // MARK: - Text

    public var title: String { strings(.exportTitle) }
    public var explanation: String { strings(.exportExplanation) }
    public var scopeLabel: String { strings(.exportScopeLabel) }
    public var includeMediaLabel: String { strings(.exportIncludeMedia) }
    public var includeMediaHint: String { strings(.exportIncludeMediaHint) }
    public var submitTitle: String { strings(.exportSubmit) }
    public var preparingMessage: String { strings(.exportPreparing) }
    public var readyMessage: String { strings(.exportReady) }
    public var downloadTitle: String { strings(.exportDownload) }
    public var closeTitle: String { strings(.plantsClose) }

    public func scopeName(_ scope: ExportScope) -> String {
        switch scope {
        case .account: strings(.exportScopeAccount)
        case .garden: strings(.exportScopeGarden)
        }
    }

    /// Stated, not hidden. A link that quietly stops working is worse than one
    /// that says when it will.
    public func expiryText(_ access: MediaAccess) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return String(
            format: strings(.exportExpires), formatter.string(from: access.expiresAt)
        )
    }

    /// Only offered when there is a garden to scope to.
    public var availableScopes: [ExportScope] {
        gardenId == nil ? [.account] : [.account, .garden]
    }

    // MARK: - Commands

    public func submit() async {
        state = .submitting
        do {
            let request = try await gateway.requestExport(
                scope: scope,
                gardenId: gardenId,
                includeMedia: includeMedia,
                idempotencyKey: generateIdempotencyKey()
            )
            state = .preparing(request)
            await poll(request.id)
        } catch {
            state = .failed(message: message(for: error))
        }
    }

    /// Polls until the package is built or the attempt ends.
    ///
    /// Cancellation-aware, so leaving the screen stops the polling rather than
    /// leaving a task talking to a server nobody is listening to.
    private func poll(_ exportRequestId: String) async {
        while !Task.isCancelled {
            try? await Task.sleep(for: Self.pollInterval)
            guard !Task.isCancelled else { return }

            do {
                let request = try await gateway.getExport(exportRequestId: exportRequestId)
                if request.isInProgress {
                    state = .preparing(request)
                    continue
                }
                if request.isDownloadable {
                    let access = try await gateway.getExportDownload(
                        exportRequestId: exportRequestId
                    )
                    state = .ready(request, access)
                } else {
                    state = .failed(message: strings(.exportFailed))
                }
                return
            } catch {
                state = .failed(message: message(for: error))
                return
            }
        }
    }

    /// Two failures have real remedies and neither is "try again": a package
    /// already building has to finish, and a stale session has to be renewed.
    private func message(for error: Error) -> String {
        guard
            let gatewayError = error as? APIGatewayError,
            case let .service(envelope, _, _) = gatewayError
        else {
            return strings(.exportFailed)
        }

        switch envelope.code {
        case "export.active_export_exists": return strings(.exportAlreadyRunning)
        case "export.recent_authentication_required": return strings(.exportReauthenticate)
        default: return strings(.exportFailed)
        }
    }
}
