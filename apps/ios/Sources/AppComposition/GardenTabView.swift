import CoreDesignSystem
import CoreLocalization
import FeatureGardens
import FeatureMap
import FeatureObservations
import FeaturePlants
import FeatureHealth
import FeatureRecommendations
import FeatureSyncConflicts
import FeatureTasks
import SwiftUI

/// One garden's five primary surfaces, as a tab bar.
///
/// This replaces the arrangement where `GardenSettingsView` — a `Form` holding
/// rename and archive — also held `NavigationLink`s to Today, the map, plants,
/// observations, tasks, and sync conflicts. That made the app's entire
/// substance a sub-page of its settings: opening the app landed on a settings
/// screen, and reaching anything took two or three pushes.
///
/// A tab bar is the right primary-navigation pattern here rather than, say, a
/// sidebar or a stack, because these five surfaces are peers a gardener moves
/// between constantly and in no fixed order — check Today, glance at the map,
/// log what you saw, tick a task off. None is a step in a sequence, so none
/// belongs behind another. Settings went where settings belong: behind one
/// button, presented as a sheet, holding only the things that configure the
/// garden rather than the things it is made of.
///
/// Five, not six: iPhone collapses a sixth tab into a "More" list, which would
/// bury whichever surface lost the draw. Plan upload, sync conflicts, and
/// service status are configuration, not daily surfaces, so they live inside
/// the settings sheet.
///
/// Source: architecture/ios-application-design.md, section "14. Navigation";
/// work package P8-UX-01.
struct GardenTabView: View {
    private let composition: AppCompositionRoot
    private let gardenId: String
    private let gardenName: String
    private let onSwitchGarden: () -> Void

    @State private var isSettingsPresented = false
    /// Which tab is showing.
    ///
    /// Held here rather than left to `TabView`'s own default so the shell —
    /// not the framework — owns the answer to "where is the reader", which a
    /// deep link or a post-conversion jump will need.
    @State private var selection = 0

    init(
        composition: AppCompositionRoot,
        gardenId: String,
        gardenName: String,
        onSwitchGarden: @escaping () -> Void
    ) {
        self.composition = composition
        self.gardenId = gardenId
        self.gardenName = gardenName
        self.onSwitchGarden = onSwitchGarden
    }

    private var strings: LocalizedStrings { composition.localizedStrings }

    var body: some View {
        TabView(selection: $selection) {
            Tab(strings(.shellTabToday), systemImage: "sun.max.fill", value: 0) {
                stack {
                    TodayView(model: composition.makeTodayViewModel(gardenId: gardenId))
                        .navigationDestination(for: TodayTasksRoute.self) { _ in
                            TasksListView(model: composition.makeTasksListViewModel(gardenId: gardenId))
                        }
                }
            }

            Tab(strings(.shellTabTasks), systemImage: "checklist", value: 1) {
                stack {
                    TasksListView(model: composition.makeTasksListViewModel(gardenId: gardenId))
                }
            }

            Tab(strings(.shellTabPlants), systemImage: "leaf.fill", value: 2) {
                stack {
                    PlantsHomeView(model: composition.makePlantsHomeViewModel(gardenId: gardenId)) { plantId in
                        AnyView(
                            PlantDetailView(
                                model: composition.makePlantDetailViewModel(gardenId: gardenId, plantId: plantId)
                            )
                        )
                    }
                }
            }

            Tab(strings(.shellTabJournal), systemImage: "book.closed.fill", value: 3) {
                stack {
                    ObservationsTimelineView(
                        model: composition.makeObservationsTimelineViewModel(gardenId: gardenId)
                    )
                }
            }

            Tab(strings(.shellTabMap), systemImage: "map.fill", value: 4) {
                stack {
                    MapEditorView(model: composition.makeMapEditorViewModel(gardenId: gardenId))
                }
            }
        }
        .tint(Palette.accent)
        .sheet(isPresented: $isSettingsPresented) {
            GardenSettingsSheet(
                composition: composition,
                gardenId: gardenId,
                onSwitchGarden: {
                    isSettingsPresented = false
                    onSwitchGarden()
                }
            )
        }
    }

    /// One tab: its own `NavigationStack`, so each surface keeps its own
    /// history and switching tabs never discards where the reader was.
    ///
    /// The garden button is applied here rather than per screen, so settings
    /// are one tap away from all five surfaces instead of only from whichever
    /// one happened to own them.
    private func stack<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content()
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        Button {
                            isSettingsPresented = true
                        } label: {
                            Label(gardenName, systemImage: "tree.fill")
                                .labelStyle(.titleAndIcon)
                                .font(Typography.detail)
                        }
                        .accessibilityIdentifier("shell.gardenMenu")
                    }
                }
        }
    }
}

/// The garden's settings, presented as a sheet from any tab.
///
/// Holds what actually configures a garden — its name, its lifecycle, the
/// property plan behind its map, the conflicts its synchronization is waiting
/// on, and the service's own health — plus the way back to the garden list.
private struct GardenSettingsSheet: View {
    let composition: AppCompositionRoot
    let gardenId: String
    let onSwitchGarden: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            GardenSettingsView(
                model: composition.makeGardenSettingsViewModel(gardenId: gardenId),
                onSwitchGarden: onSwitchGarden
            )
            .navigationDestination(for: GardenPlanUploadRoute.self) { route in
                GardenPlanUploadView(
                    model: composition.makeGardenPlanUploadViewModel(gardenId: route.gardenId)
                )
            }
            .navigationDestination(for: GardenSyncConflictsRoute.self) { route in
                SyncConflictsView(model: composition.makeSyncConflictsViewModel(gardenId: route.gardenId))
            }
            .navigationDestination(for: GardenServiceHealthRoute.self) { _ in
                ServiceHealthView(model: composition.makeServiceHealthViewModel())
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(composition.localizedStrings(.plantsClose)) { dismiss() }
                }
            }
        }
    }
}
