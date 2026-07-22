import SwiftUI

/// Service status screen.
///
/// The view renders immutable state and emits one intent. It performs no
/// networking, holds no domain authority, and knows no error taxonomy.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation".
public struct ServiceHealthView: View {
    @State private var model: ServiceHealthViewModel

    public init(model: ServiceHealthViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(model.title)
                .font(.title2)
                .accessibilityAddTraits(.isHeader)

            content

            Button(model.refreshActionTitle) {
                Task { await model.refresh() }
            }
            .accessibilityIdentifier("health.refresh")
        }
        .padding()
        .task { await model.refresh() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle, .checking:
            ProgressView()
                .accessibilityIdentifier("health.progress")

        case let .loaded(summary):
            VStack(alignment: .leading, spacing: 8) {
                Text(summary.headline)
                    .accessibilityIdentifier("health.headline")
                Text(summary.version)
                    .font(.footnote)

                ForEach(summary.unavailableDependencies, id: \.self) { line in
                    Text(line).font(.footnote)
                }
            }

        case let .failed(message):
            Text(message)
                .accessibilityIdentifier("health.failure")
        }
    }
}
