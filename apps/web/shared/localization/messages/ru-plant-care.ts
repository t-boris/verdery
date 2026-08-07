/**
 * Russian messages for the per-plant care panel — see `en-plant-care.ts`
 * for why the water copy states a measurement and never an instruction.
 */
import type { englishPlantCareMessages } from './en-plant-care';

export const russianPlantCareMessages: Record<keyof typeof englishPlantCareMessages, string> = {
  'plantCare.title': 'Уход',
  'plantCare.loading': 'Загружаем данные по уходу за растением.',
  'plantCare.nothingOpen': 'Сейчас по этому растению ничего не открыто.',
  'plantCare.recommendationsTitle': 'Предлагается',
  'plantCare.tasksTitle': 'Открытые задачи',
  'plantCare.ruleIdentity': 'Правило {key} v{version}',
  'plantCare.due': 'Срок {date}',
  'plantCare.water.unknown':
    'Для этого сада ещё нет записей об осадках, поэтому водный баланс неизвестен. Неизвестно — не то же самое, что сухо, поэтому проверка полива не формируется.',
  'plantCare.water.overDays': 'осадков за последние {days} дней',
  'plantCare.water.barLabel':
    '{accumulated} мм осадков против {reference} мм, которые обычно даёт неделя',
  'plantCare.water.short':
    'Это на {shortfall} мм меньше обычного для такого окна — стоит проверить, не нужен ли полив.',
  'plantCare.water.sufficient': 'Не меньше {reference} мм, которые обычно даёт это окно.',
  'plantCare.water.coverage': 'Измерено за {covered} из {days} дней.',
};
