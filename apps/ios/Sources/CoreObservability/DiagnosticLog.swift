import Foundation
import OSLog

/// Severity of a diagnostic record.
public enum DiagnosticLevel: String, Sendable, CaseIterable {
    case debug
    case info
    case warning
    case error
}

/// Structured diagnostics with redaction applied at the boundary.
///
/// Redaction is enforced here rather than trusted to call sites, because a
/// single unredacted token or precise coordinate in a log is a privacy incident
/// regardless of which module wrote it.
///
/// Source: architecture/ios-application-design.md, sections "16. Error Handling"
/// and "17. Security and Privacy".
public protocol DiagnosticLog: Sendable {
    func record(
        _ level: DiagnosticLevel,
        _ message: String,
        correlationId: CorrelationIdentifier?
    )
}

extension DiagnosticLog {
    public func record(_ level: DiagnosticLevel, _ message: String) {
        record(level, message, correlationId: nil)
    }
}

/// Default log backed by the unified logging system.
public struct SystemDiagnosticLog: DiagnosticLog {
    private let logger: Logger

    public init(subsystem: String, category: String) {
        self.logger = Logger(subsystem: subsystem, category: category)
    }

    public func record(
        _ level: DiagnosticLevel,
        _ message: String,
        correlationId: CorrelationIdentifier?
    ) {
        // Messages are interpolated as `public` deliberately: only text this
        // module has already accepted as safe reaches here, and marking it
        // private would produce `<private>` placeholders that make production
        // diagnosis impossible.
        let line = correlationId.map { "[\($0.value)] \(message)" } ?? message

        switch level {
        case .debug: logger.debug("\(line, privacy: .public)")
        case .info: logger.info("\(line, privacy: .public)")
        case .warning: logger.warning("\(line, privacy: .public)")
        case .error: logger.error("\(line, privacy: .public)")
        }
    }
}

/// Log that discards everything, for tests and for previews.
public struct NoOperationDiagnosticLog: DiagnosticLog {
    public init() {}

    public func record(
        _ level: DiagnosticLevel,
        _ message: String,
        correlationId: CorrelationIdentifier?
    ) {}
}
