import type { englishSeasonalAcceptanceMessages } from './en-seasonal-acceptance';

/**
 * Russian messages for the seasonal-timing acceptance queue.
 *
 * Typed against the English module so a missing or invented key is a
 * compile error.
 */
export const russianSeasonalAcceptanceMessages: Readonly<
  Record<keyof typeof englishSeasonalAcceptanceMessages, string>
> = {
  'seasonalAcceptance.title': 'Сезонные сроки к принятию',
  'seasonalAcceptance.description':
    'Месяцы посева, пересадки и сбора урожая для растений, которые вы выращиваете. Эти данные общие для всех садов, поэтому в вашем саду они не используются, пока вы их не примете. Принятие включает проверки окна посева, повторных посадок и севооборота только для этого сада.',
  'seasonalAcceptance.loading': 'Загрузка сезонных сроков.',
  'seasonalAcceptance.retry': 'Повторить',
  'seasonalAcceptance.accept': 'Использовать в этом саду',
  'seasonalAcceptance.awaitingReview': 'Без агрономического ревью',
  'seasonalAcceptance.source': 'Источник: {source}',
  'seasonalAcceptance.noWindowsConfigured': 'В этой записи не указано ни одного месяца.',
  'seasonalAcceptance.empty':
    'Решать больше нечего. Сезонные сроки приняты для всех растений, которые вы выращиваете.',

  'seasonalAcceptance.hemisphereUnknownTitle': 'У этого сада ещё нет местоположения',
  'seasonalAcceptance.hemisphereUnknownDescription':
    'В двух полушариях месяцы посева противоположны, поэтому решать нечего, пока у сада нет местоположения.',
  'seasonalAcceptance.setLocation': 'Указать местоположение',

  'seasonalAcceptance.notAcceptableTitle': 'Принимать нечего',
  'seasonalAcceptance.notAcceptableDescription':
    'Эти сроки недоступны для этого сада. Возможно, они уже приняты или относятся к другому полушарию.',
};
