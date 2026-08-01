/**
 * Russian messages for the observations feature — mirrors
 * `en-observations.ts`.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const russianObservationsMessages = {
  'observations.pageTitle': 'Наблюдения',
  'observations.pageDescription': 'Хронологическая история наблюдений этого сада.',
  'observations.recordTitle': 'Записать наблюдение',
  'observations.recordSubmit': 'Записать наблюдение',
  'observations.noteTextLabel': 'Заметка',
  'observations.conditionSummaryLabel': 'Сводка состояния',
  'observations.noteOrSummaryRequired': 'Введите заметку или сводку состояния.',
  'observations.plantIdLabel': 'ID растения (необязательно)',
  'observations.gardenObjectIdLabel': 'Зона сада (ID объекта карты, необязательно)',
  'observations.observedAtLabel': 'Время наблюдения',
  'observations.mediaGapHint':
    'Прикрепление фотографий пока не связано с наблюдениями, хотя загрузка файлов уже работает в другом месте приложения (фотография сада, на странице настроек сада). Для записи наблюдения достаточно заметки и/или сводки состояния.',
  'observations.historyTitle': 'История',
  'observations.loading': 'Загрузка истории наблюдений.',
  'observations.retry': 'Повторить',
  'observations.empty': 'Наблюдений пока не записано.',
  'observations.isCorrectedBadge': 'Исправлено',
  'observations.correctionOf': '{kind} наблюдения {id}',
  'observations.photoLabel': 'Фотография',
  'observations.analysisSuggestion': 'Возможно: {label} (уверенность {confidence})',
  'observations.analysisRequiresConfirmation':
    'Это автоматическое предположение, а не подтверждённый диагноз — требуется ваше подтверждение.',
  'observations.analysisRequestsMoreEvidence':
    'Для этого предположения запрошены дополнительные данные.',
  'observations.correctAction': 'Исправить это наблюдение',
  'observations.correctionExplanation':
    'Исправление добавляет новую запись в историю; оно никогда не изменяет и не удаляет исходную запись.',
  'observations.correctionKindLabel': 'Тип исправления',
  'observations.correctionSubmit': 'Записать исправление',
  'observations.correctionCancel': 'Отмена',

  'observations.analysisEvidenceSummary': 'Что на это указывает: {summary}',
  'observations.analysisAlternativeExplanationsLabel': 'Другие возможные объяснения',
  'observations.analysisModelUnavailable':
    'Для этой фотографии не удалось обратиться к ИИ-модели — это заглушка, а не предположение, на которое стоит опираться.',
  'observations.analysisDispositionLabel': 'Ваша оценка',
  'observations.analysisSaveDisposition': 'Сохранить оценку',
  'observations.analysisDispositionSaved': 'Оценка сохранена.',
  'observations.analysisDispositionSetBy': 'Оценено {date}',

  'observations.enum.analysisKind.stress': 'Стресс',
  'observations.enum.analysisKind.disease': 'Болезнь',
  'observations.enum.analysisKind.pest': 'Вредитель',
  'observations.enum.analysisKind.other': 'Другое',
  'observations.enum.correctionKind.amendment': 'Дополнение',
  'observations.enum.correctionKind.supersede': 'Замена',
  'observations.enum.actorType.user': 'Пользователь',
  'observations.enum.actorType.system': 'Система',

  'observations.enum.safetyClass.informational': 'Информационно',
  'observations.enum.safetyClass.monitor': 'Стоит понаблюдать',
  'observations.enum.safetyClass.expertReviewRecommended': 'Рекомендуется консультация специалиста',

  'observations.enum.disposition.unresolved': 'Ещё не рассмотрено',
  'observations.enum.disposition.confirmedExternally': 'Подтверждено отдельно',
  'observations.enum.disposition.acceptedAsObservation': 'Принято как наблюдение',
  'observations.enum.disposition.rejected': 'Отклонено',
};
