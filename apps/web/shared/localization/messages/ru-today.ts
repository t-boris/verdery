import type { englishTodayMessages } from './en-today';

/**
 * Russian messages for the Today view and recommendations (P7-WEB-01).
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `MessageCatalogue` gives the full
 * catalogues, applied at this module's own boundary.
 */
export const russianTodayMessages: Readonly<Record<keyof typeof englishTodayMessages, string>> = {
  'today.pageTitle': 'Сегодня',
  'today.pageDescription':
    'Приоритетные рекомендации по уходу за этим садом — каждая с причиной, доказательствами и действиями.',
  'today.loading': 'Загрузка рекомендаций.',
  'today.retry': 'Повторить',
  'today.empty': 'Сейчас ничего не требует внимания.',

  'today.priorityDisplay': 'Приоритет {score} / 100',
  'today.windowRange': 'Актуально {start} – {end}',
  'today.windowUntil': 'Выполнить до {end}',
  'today.windowFrom': 'Актуально с {start}',
  'today.reasonLabel': 'Причина',
  'today.safetyElevatedRisk': 'Повышенный риск',
  'today.safetyElevatedRiskNote':
    'Эта рекомендация связана с повышенным риском. Внимательно оцените её перед выполнением.',
  'today.uncertaintyContribution': 'Уверенность: {contribution} баллов',
  'today.uncertaintyMissing': 'Для этой рекомендации не записан показатель уверенности.',

  'today.basis.sourceOwnRecords': 'на основе собственных записей этого сада',
  'today.basis.sourceUserDeclaredLifecycleStage':
    'на основе указанной вами стадии жизненного цикла',
  'today.basis.sourceForecast': 'на основе прогноза погоды',
  'today.basis.weatherFresh': 'по свежим погодным данным',
  'today.basis.weatherStale': 'по кэшированным погодным данным, которые могут быть устаревшими',
  'today.basis.daysSince': 'по данным за {days} дней',
  'today.detailEntry': '{key}: {value}',
  'today.detailValue': 'Значение: {value}',

  'today.detailsShow': 'Показать доказательства и факторы',
  'today.detailsHide': 'Скрыть доказательства и факторы',
  'today.factorsTitle': 'Факторы приоритета',
  'today.factorContribution': '{contribution} баллов',
  'today.evidenceTitle': 'Доказательства',
  'today.evidencePlantNamed': 'Растение: {name}',
  'today.evidenceRecordReference': 'Запись {id}',
  'today.ruleIdentity': 'Правило {key}, версия {version}',

  'today.enum.evidence.plantIdentity': 'Идентичность растения',
  'today.enum.evidence.gardenContext': 'Контекст сада',
  'today.enum.evidence.weather': 'Погода',
  'today.enum.evidence.soilMoisture': 'Влажность почвы',
  'today.enum.evidence.observation': 'Наблюдение',
  'today.enum.evidence.task': 'Задача',
  'today.enum.evidence.lifecycleStage': 'Стадия жизненного цикла',
  'today.enum.evidence.geometryExposure': 'Геометрия и освещённость',
  'today.enum.evidence.userPreference': 'Предпочтения',

  'today.enum.factor.urgencyWindow': 'Окно срочности',
  'today.enum.factor.plantImpact': 'Влияние на растение',
  'today.enum.factor.confidence': 'Уверенность',
  'today.enum.factor.weatherOpportunityOrRisk': 'Погодная возможность или риск',
  'today.enum.factor.userEffortAndAvailability': 'Усилия и доступность',
  'today.enum.factor.taskOverlap': 'Пересечение с задачами',
  'today.enum.factor.safetyConstraint': 'Ограничения безопасности',
  'today.enum.factor.seasonalConstraint': 'Сезонные ограничения',

  'today.complete': 'Завершить',
  'today.dismiss': 'Отклонить',
  'today.markIrrelevant': 'Не актуально',
  'today.markIrrelevantRecorded': 'Спасибо — отзыв записан.',
  'today.postpone': 'Отложить',
  'today.postponeUntilLabel': 'Показать снова после (необязательно)',
  'today.postponeSubmit': 'Отложить',
  'today.postponeCancel': 'Отмена',
  'today.convertToTask': 'В задачи',

  'tasks.fromRecommendation': 'Создана из рекомендации',
} as const;
