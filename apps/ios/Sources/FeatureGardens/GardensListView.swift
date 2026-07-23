import SwiftUI

/// Garden list and inline create form: the first-garden vertical slice.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation";
/// implementation-plan.md work package P2-IOS-01.
public struct GardensListView: View {
    @State private var model: GardensListViewModel
    private let destination: (String) -> AnyView

    public init(model: GardensListViewModel, destination: @escaping (String) -> AnyView) {
        _model = State(wrappedValue: model)
        self.destination = destination
    }

    public var body: some View {
        List {
            Section {
                content
            }

            Section(model.createTitle) {
                TextField(model.createNameLabel, text: $model.newGardenName)
                    .accessibilityIdentifier("gardens.create.nameField")

                Button(model.createSubmitTitle) {
                    Task { await model.submitNewGarden() }
                }
                .disabled(model.isCreating)
                .accessibilityIdentifier("gardens.create.submit")

                if let message = model.createErrorMessage {
                    Text(message).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(model.title)
        .task { await model.load() }
        .refreshable { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView(model.loadingMessage)
                .accessibilityIdentifier("gardens.loading")

        case let .loaded(items) where items.isEmpty:
            Text(model.emptyMessage)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("gardens.empty")

        case let .loaded(items):
            ForEach(items) { item in
                NavigationLink(value: item.id) {
                    row(for: item)
                }
            }
            .navigationDestination(for: String.self) { gardenId in
                destination(gardenId)
            }

        case let .failed(message):
            VStack(alignment: .leading, spacing: 8) {
                Text(message)
                    .accessibilityIdentifier("gardens.failure")
                Button(model.retryTitle) {
                    Task { await model.load() }
                }
            }
        }
    }

    private func row(for item: GardenSummary) -> some View {
        VStack(alignment: .leading) {
            Text(item.name).font(.headline)
            Text("\(item.lifecycleLabel) · \(item.roleLabel)")
                .font(.footnote)
                .foregroundStyle(.secondary)

            if let syncStatusLabel = item.syncStatusLabel {
                Text(syncStatusLabel)
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("gardens.row.syncStatus")
            }
        }
    }
}
