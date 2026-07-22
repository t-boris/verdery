import SwiftUI

/// The accessible object list: a real VoiceOver-navigable `List`, not a
/// decorative summary of the canvas. Selecting a row selects the object and
/// opens its property view, exactly like a canvas tap followed by Edit —
/// this is a genuine alternative interaction path, not a read-only mirror.
struct MapObjectListView: View {
    let rows: [MapAccessibleObjectRow]
    let emptyMessage: String
    let deleteActionTitle: String
    let restoreActionTitle: String
    let onSelect: (String) -> Void
    let onDelete: (String) -> Void
    let onRestore: (String) -> Void

    var body: some View {
        if rows.isEmpty {
            Text(emptyMessage)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("map.list.empty")
        } else {
            List(rows) { row in
                Button {
                    onSelect(row.id)
                } label: {
                    rowLabel(row)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(row.accessibilityLabel)
                .accessibilityIdentifier("map.list.row.\(row.id)")
                .accessibilityAddTraits(.isButton)
                .swipeActions(edge: .trailing) {
                    if row.isDeleted {
                        Button(restoreActionTitle) { onRestore(row.id) }
                            .tint(.green)
                    } else {
                        Button(deleteActionTitle, role: .destructive) { onDelete(row.id) }
                    }
                }
            }
            .listStyle(.plain)
        }
    }

    /// Visible content stays plain text plus an SF Symbol — never colour
    /// alone — so a sighted user reading without VoiceOver still sees the
    /// deleted state; the `accessibilityLabel` above carries the same fact
    /// for VoiceOver, in words, on the row as a whole.
    private func rowLabel(_ row: MapAccessibleObjectRow) -> some View {
        HStack {
            Image(systemName: row.isDeleted ? "trash" : "circle.fill")
                .foregroundStyle(row.isDeleted ? Color.secondary : Color.accentColor)
                .imageScale(.small)
            Text(row.title)
                .strikethrough(row.isDeleted)
                .foregroundStyle(row.isDeleted ? Color.secondary : Color.primary)
            Spacer()
        }
    }
}
