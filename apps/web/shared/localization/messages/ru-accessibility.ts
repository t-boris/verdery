import type { MessageKey } from '../catalogue';

import type { englishAccessibilityMessages } from './en-accessibility';

/** Russian messages for the accessibility and localization pass. Typed against the English module. */
export const russianAccessibilityMessages: Readonly<
  Record<keyof typeof englishAccessibilityMessages & MessageKey, string>
> = {
  'map.canvas.ariaLabel': 'Холст карты сада',
  'map.canvas.keyboardHelp':
    'Стрелки перемещают карту или выбранный объект; удерживайте Shift для большего шага. Плюс и минус меняют масштаб. Delete удаляет выбранный объект. Escape снимает выделение или сбрасывает инструмент. Рисование фигуры и перетаскивание вершины требуют указателя и не имеют эквивалента на клавиатуре; используйте список объектов рядом с картой, чтобы выбирать, переименовывать, перемещать и удалять объекты без него.',
  'map.units.centimetres': '{value} см',
  'map.units.metres': '{value} м',
  'map.units.squareMetres': '{value} м²',
  'auth.emailInvalid': 'Введите адрес электронной почты, например name@example.com.',
};
