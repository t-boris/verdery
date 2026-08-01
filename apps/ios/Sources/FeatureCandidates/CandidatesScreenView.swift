import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The candidates feature's entry point: a browsable, searchable, filterable
/// list (`CandidatesListView`, backed by `ListCandidates`), with "Add a
/// candidate" behind a toolbar button — mirrors
/// `FeaturePlants.PlantsHomeView`'s identical composition shape.
public struct CandidatesScreenView: View {
    @State private var model: CandidatesListViewModel
    @State private var makeAddModel: () -> AddCandidateViewModel
    /// The candidate this screen pushed to, if any — a local `@State`
    /// driving `.navigationDestination(item:)` rather than a nested
    /// `NavigationStack`, the same reasoning `PlantsHomeView.openedPlantId`
    /// documents.
    @State private var openedCandidateId: String?
    @State private var isAddPresented = false
    @State private var addModel: AddCandidateViewModel?
    private let destination: (String) -> AnyView

    public init(
        model: CandidatesListViewModel,
        makeAddModel: @escaping () -> AddCandidateViewModel,
        destination: @escaping (String) -> AnyView
    ) {
        _model = State(wrappedValue: model)
        self.makeAddModel = makeAddModel
        self.destination = destination
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space5) {
                Text(model.description)
                    .font(Typography.detail)
                    .foregroundStyle(Palette.textMuted)

                CandidatesListView(model: model) { candidate in
                    openedCandidateId = candidate.id
                }
            }
            .padding(Metrics.space4)
        }
        .navigationTitle(model.title)
        .screenBackground()
        .navigationDestination(item: $openedCandidateId) { candidateId in
            destination(candidateId)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    let newAddModel = makeAddModel()
                    addModel = newAddModel
                    isAddPresented = true
                } label: {
                    Label(model.addButtonTitle, systemImage: "plus")
                }
                .accessibilityIdentifier("candidates.add.open")
            }
        }
        .sheet(isPresented: $isAddPresented) {
            if let addModel {
                AddCandidateSheetView(model: addModel, onCancel: { isAddPresented = false }) { didSucceed in
                    Haptics.play(didSucceed ? .success : .failure)
                    if didSucceed {
                        isAddPresented = false
                        if let createdId = addModel.createdCandidateId {
                            openedCandidateId = createdId
                            addModel.consumeNavigation()
                        }
                    }
                }
            }
        }
        .onChange(of: openedCandidateId) { _, newValue in
            // A candidate added or edited on the pushed detail screen should
            // show up in the list without the reader having to pull to
            // refresh — the list reloads once the detail screen is
            // dismissed back to this one, matching `PlantsHomeView`'s
            // identical `onChange(of: openedPlantId)` reasoning.
            if newValue == nil {
                Task { await model.load() }
            }
        }
    }
}
