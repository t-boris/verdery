import CoreDomain
import CoreLocalization
import SwiftUI

/// Sheet presented after a canvas tap while placing a `gate`: since
/// `GateDetails.fenceObjectId` is required, the user must choose which
/// existing fence the new gate belongs to before `createObject` is
/// submitted — see `MapEditorViewModelEditing.swift`'s
/// `createGate(fenceObjectId:)`. Only shown when at least one fence exists
/// (`MapEditorViewModel.hasFence` gates the toolbar button itself).
struct MapGateFencePickerView: View {
    let fences: [GardenMapObject]
    let strings: LocalizedStrings
    let onSelect: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            List(fences) { fence in
                Button {
                    onSelect(fence.id)
                } label: {
                    Text(fence.label?.isEmpty == false ? fence.label! : strings(.mapListUntitled))
                }
                .accessibilityIdentifier("map.gatePicker.fence.\(fence.id)")
            }
            .navigationTitle(strings(.mapGatePickerTitle))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(strings(.mapPropertyClose), action: onCancel)
                        .accessibilityIdentifier("map.gatePicker.cancel")
                }
            }
        }
    }
}
