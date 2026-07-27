import type { englishSeasonalPlanMessages } from './en-seasonal-plan';

/**
 * Russian messages for the Seasonal plan section (P9D-UX-01).
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `ru-today.ts` gives itself.
 */
export const russianSeasonalPlanMessages: Readonly<
  Record<keyof typeof englishSeasonalPlanMessages, string>
> = {
  'seasonalPlan.pageTitle': 'Сезонный план',
  'seasonalPlan.pageDescription':
    'Настроенные окна посева, пересадки и сбора урожая для этого сада, а также текущее состояние севооборота грядок.',
  'seasonalPlan.loading': 'Загрузка сезонного плана.',
  'seasonalPlan.retry': 'Повторить',

  'seasonalPlan.hemisphereUnknownTitle': 'Мы пока не знаем ваш сезон',
  'seasonalPlan.hemisphereUnknownDescription':
    'Сезонные окна зависят от полушария, в котором находится сад, а это становится известно только после указания местоположения сада на карте.',
  'seasonalPlan.hemisphereUnknownLink': 'Указать местоположение сада на карте',

  'seasonalPlan.plantFallback': 'Растение {plantId}',

  'seasonalPlan.calendar.title': 'Календарь',
  'seasonalPlan.calendar.empty': 'Пока нет активных растений для составления календаря.',
  'seasonalPlan.calendar.noSeasonalData':
    'Для этого растения пока нет проверенных сезонных данных.',
  'seasonalPlan.calendar.noWindowsConfigured':
    'Сезонный факт зафиксирован, но окна посева, пересадки или сбора урожая не настроены.',
  'seasonalPlan.calendar.sowIndoorsLabel': 'Посев в помещении',
  'seasonalPlan.calendar.sowOutdoorsLabel': 'Посев в открытый грунт',
  'seasonalPlan.calendar.transplantLabel': 'Пересадка',
  'seasonalPlan.calendar.harvestLabel': 'Сбор урожая',
  'seasonalPlan.calendar.monthRange': '{start} – {end}',
  'seasonalPlan.calendar.singleMonth': '{month}',

  'seasonalPlan.rotation.title': 'Севооборот',
  'seasonalPlan.rotation.conflictsEmpty': 'Сейчас нет конфликтов периода отдыха.',
  'seasonalPlan.rotation.conflictBadge': 'Конфликт периода отдыха',
  'seasonalPlan.rotation.conflictText':
    'На этой грядке {elapsedDays} дн. назад росло семейство {priorFamily}; рекомендованный отдых для {family} — {restPeriodThresholdDays} дн.',
  'seasonalPlan.rotation.showOthers': 'Показать все отслеживаемые грядки',
  'seasonalPlan.rotation.hideOthers': 'Скрыть все отслеживаемые грядки',
  'seasonalPlan.rotation.othersEmpty':
    'История севооборота для других грядок пока не отслеживается.',
  'seasonalPlan.rotation.noPriorOccupant':
    '{family}: для этой грядки нет данных о предыдущей посадке.',
  'seasonalPlan.rotation.differentFamily':
    '{family}: на этой грядке ранее росло семейство {priorFamily} — другое семейство, конфликта севооборота нет.',
  'seasonalPlan.rotation.noRestPeriodConfigured':
    '{family}: на этой грядке {elapsedDays} дн. назад росло семейство {priorFamily}; период отдыха для этого семейства не настроен.',
  'seasonalPlan.rotation.restDurationUnknown':
    '{family}: на этой грядке ранее росло семейство {priorFamily}, но дата окончания посадки неизвестна.',
  'seasonalPlan.rotation.restPeriodElapsed':
    '{family}: на этой грядке {elapsedDays} дн. назад росло семейство {priorFamily} — рекомендованный отдых в {restPeriodThresholdDays} дн. уже прошёл.',
};
