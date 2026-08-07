import type { englishCareRulesMessages } from './en-care-rules';

/**
 * Russian messages for the care-rules disclosure.
 *
 * Typed against the English module so a missing or invented key is a
 * compile error.
 */
export const russianCareRulesMessages: Readonly<
  Record<keyof typeof englishCareRulesMessages, string>
> = {
  'careRules.title': 'Автоматические проверки',
  'careRules.description':
    'Они выполняются сами и решают, что нужно этому саду. Всё, что заблокировано, показано с причиной.',
  'careRules.loading': 'Загрузка автоматических проверок.',
  'careRules.retry': 'Повторить',

  'careRules.activeLabel': 'Работает',
  'careRules.blockedLabel': 'Заблокировано',
  'careRules.reviewPending': 'Ожидает агрономического ревью',
  'careRules.reviewPendingExplanation':
    'Проверка выполняется, но её пороги — заглушки, пока их не подтвердит агроном.',

  'careRules.blocker.noWeatherProvider':
    'В этой среде не включён поставщик погоды. Здесь от вас ничего не зависит.',
  'careRules.blocker.gardenNotGeoreferenced':
    'У сада нет местоположения. Из координат состоит запрос погоды и из них же выводится полушарие, поэтому указание местоположения разблокирует сразу несколько проверок.',
  'careRules.blocker.noWeatherObservation':
    'Текущие условия для сада ещё не получены. Это решится само.',
  'careRules.blocker.noWeatherForecast': 'Прогноз для сада ещё не получен. Это решится само.',
  'careRules.blocker.noRainfallHistory':
    'Суточные осадки ещё не записаны, поэтому накопленный дождь неизвестен. Неизвестно — не то же самое, что сухо, поэтому проверка не гадает.',
  'careRules.blocker.noIdentifiedPlants':
    'Ни у одного активного растения нет вида. Проверка о виде ничего не может сказать о неопределённом растении.',
  'careRules.blocker.seasonalTimingNotAccepted':
    'Вы ещё не приняли сезонные сроки для растений этого сада. Примите их ниже, чтобы включить эти проверки.',
  'careRules.blocker.noPlacedPlants':
    'Ни одно активное растение не размещено в зоне сада, поэтому истории грядки нет.',
  'careRules.blocker.awaitingHorticulturalReview':
    'Пороги — заглушки, пока их не подтвердит агроном.',

  'careRules.usesWeather': 'Использует погоду',
  'careRules.tierElevated': 'Повышенный риск',
  'careRules.setLocation': 'Указать местоположение',
};
