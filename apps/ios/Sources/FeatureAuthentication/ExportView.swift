import CoreDesignSystem
import CoreDomain
import SwiftUI

/// Taking a copy of your own data.
public struct ExportView: View {
    @State private var model: ExportViewModel
    private let close: () -> Void

    public init(model: ExportViewModel, close: @escaping () -> Void) {
        _model = State(wrappedValue: model)
        self.close = close
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    SurfaceCard {
                        // The consistency boundary, stated. A package that
                        // quietly excludes this morning's work is worse than
                        // one that says where it stopped reading.
                        Text(model.explanation)
                            .font(FieldConsoleType.body.font)
                            .foregroundStyle(Palette.text)
                    }

                    content
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.closeTitle, action: close)
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .idle:
            requestForm

        case .submitting:
            LoadingStateView(model.title)
                .accessibilityIdentifier("export.submitting")

        case .preparing:
            // Leaving is explicitly allowed, and said so: generating a package
            // is minutes of work and nobody should feel pinned to a spinner.
            VStack(alignment: .leading, spacing: Metrics.space3) {
                LoadingStateView(model.preparingMessage)
                    .accessibilityIdentifier("export.preparing")
            }

        case let .ready(_, access):
            VStack(alignment: .leading, spacing: Metrics.space3) {
                InlineMessage(model.readyMessage, tone: .positive)
                    .accessibilityIdentifier("export.ready")

                ShareLink(item: access.url) {
                    Label(model.downloadTitle, systemImage: "arrow.down.circle")
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("export.download")

                Text(model.expiryText(access))
                    .font(FieldConsoleType.mono.font)
                    .foregroundStyle(Palette.textMuted)
            }

        case let .failed(message):
            VStack(alignment: .leading, spacing: Metrics.space3) {
                InlineMessage(message, tone: .negative)
                    .accessibilityIdentifier("export.failure")
                requestForm
            }
        }
    }

    private var requestForm: some View {
        VStack(alignment: .leading, spacing: Metrics.space4) {
            if model.availableScopes.count > 1 {
                ChoiceChipGrid(
                    fieldName: model.scopeLabel,
                    options: model.availableScopes.map {
                        ChoiceChipGrid.Option(
                            value: $0,
                            label: model.scopeName($0),
                            symbol: $0 == .account ? "person.crop.circle" : "leaf"
                        )
                    },
                    selection: $model.scope
                )
                .accessibilityIdentifier("export.scope")
            }

            // Genuinely a boolean, unlike the eleven that were not: including
            // the picture files is a yes-or-no with no hidden second control.
            SwitchTile(
                title: model.includeMediaLabel,
                explanation: model.includeMediaHint,
                onSymbol: "photo.fill",
                offSymbol: "photo",
                isOn: $model.includeMedia
            )
            .accessibilityIdentifier("export.includeMedia")

            Button(model.submitTitle) {
                Task { await model.submit() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("export.submit")
        }
    }
}
