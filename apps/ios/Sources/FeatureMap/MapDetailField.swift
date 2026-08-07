import CoreDesignSystem
import SwiftUI

/// One labelled value inside the object inspector.
///
/// The property editor's fields were bare `TextField`s in `Form` rows, which
/// is where most of the application's remaining form chrome lived. They are
/// composer rows now: a symbol, the value, and the field's own name carried as
/// the accessible label and the placeholder rather than as a separate line of
/// grey text above it.
struct MapDetailField: View {
    let symbol: String
    let name: String
    @Binding var text: String
    /// Raises the numeric pad for a dimension. A name or a note takes the
    /// ordinary keyboard.
    var isNumeric: Bool = false

    var body: some View {
        ComposerField(
            symbol: symbol,
            accessibilityName: name,
            placeholder: name,
            commitLabel: name,
            commitSymbol: "checkmark",
            text: $text,
            commit: {}
        )
        .modifier(NumericKeyboard(isNumeric: isNumeric))
    }
}

/// `keyboardType` is UIKit-backed and absent from the headless macOS build
/// this package also compiles for.
private struct NumericKeyboard: ViewModifier {
    let isNumeric: Bool

    func body(content: Content) -> some View {
        #if os(iOS)
        if isNumeric {
            content.keyboardType(.decimalPad)
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// A closed set of category kinds, laid flat.
///
/// Every `Picker` in this editor chose between a handful of named values —
/// fence kinds, bed kinds, zone kinds — which is exactly what a chip grid is
/// for. Flat, they are all readable before choosing rather than after.
struct MapKindChoice<Value: Hashable & CaseIterable & Sendable>: View
where Value.AllCases: RandomAccessCollection {
    let name: String
    let symbol: String
    let title: (Value) -> String
    @Binding var selection: Value

    var body: some View {
        ChoiceChipGrid(
            fieldName: name,
            options: Value.allCases.map {
                ChoiceChipGrid.Option(value: $0, label: title($0), symbol: symbol)
            },
            selection: $selection
        )
    }
}
