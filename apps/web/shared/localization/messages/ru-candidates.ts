/**
 * Russian messages for the candidates feature — mirrors `en-candidates.ts`.
 *
 * Source: architecture/web-application-design.md, section "15. Localization".
 */
export const russianCandidatesMessages = {
  'candidates.pageTitle': 'Кандидаты',
  'candidates.pageDescription':
    'Растения, которые вы рассматриваете для этого сада, но ещё не посадили.',
  'candidates.searchLabel': 'Поиск по названию',
  'candidates.filterLegend': 'Фильтр по статусу',
  'candidates.filterPriorityLegend': 'Фильтр по приоритету',
  'candidates.listLoading': 'Загрузка кандидатов.',
  'candidates.listLoadingMore': 'Загрузка дополнительных кандидатов.',
  'candidates.listRetry': 'Повторить',
  'candidates.listEmpty': 'По текущему поиску и фильтрам кандидаты не найдены.',
  'candidates.listLoadMore': 'Загрузить ещё',
  'candidates.priorityDisplay': 'Приоритет: {priority}',
  'candidates.quantityDisplay': 'Растений: {quantity}',

  'candidates.addTitle': 'Добавить кандидата',
  'candidates.addSubmit': 'Добавить кандидата',
  'candidates.addFromPhotoTitle': 'Добавить по фото',
  'candidates.addFromPhotoDescription':
    'Загрузите фото растения. Кандидат будет создан автоматически, с полями, предзаполненными на основе предположения ИИ о виде растения — при необходимости отредактируйте или удалите его позже.',
  'candidates.addFromPhotoCreating': 'Создаём кандидата по вашему фото…',
  'candidates.photoGalleryTitle': 'Фото',
  'candidates.photoOpenFullscreen': 'Открыть фото на весь экран',
  'candidates.photoCloseFullscreen': 'Закрыть полноэкранное фото',
  'candidates.identificationTitle': 'Распознавание растения',
  'candidates.identificationDescription':
    'Повторно распознать кандидата по исходной фотографии. Большие оригиналы подготавливаются автоматически; отдельного лимита размера для распознавания нет.',
  'candidates.identificationAction': 'Распознать по фото',
  'candidates.identificationPreparing': 'Подготавливаем и распознаём…',
  'candidates.identificationApplied': 'Распознавание применено.',
  'candidates.displayNameLabel': 'Название',
  'candidates.displayNameRequired': 'Введите название длиной до 200 символов.',
  'candidates.taxonomySearchLabel': 'Поиск по каталогу таксономии',
  'candidates.taxonomySelectLabel': 'Таксономическая ссылка',
  'candidates.taxonomyNone': 'Не определено',
  'candidates.taxonomySearchFailed': 'Не удалось выполнить поиск по каталогу таксономии.',
  'candidates.varietyLabelLabel': 'Сорт',
  'candidates.groupingKindLabel': 'Группировка',
  'candidates.quantityLabel': 'Количество',
  'candidates.quantityInvalid':
    'Укажите количество не менее 1 для ряда или группы; оставьте пустым для отдельного растения.',
  'candidates.rationaleNoteLabel': 'Обоснование',
  'candidates.priorityLabel': 'Приоритет',
  'candidates.priorityNone': 'Не задан',
  'candidates.priceAmountLabel': 'Цена',
  'candidates.priceCurrencyLabel': 'Валюта',
  'candidates.purchaseSourceLabel': 'Источник покупки',
  'candidates.proposedGardenAreaMapObjectIdLabel': 'Предлагаемая зона сада',
  'candidates.proposedPlacementMapObjectIdLabel': 'Предлагаемое размещение',
  'candidates.mapObjectIdHint': 'Выберите объект с карты этого сада.',
  'candidates.mapObjectNone': 'Не выбрано',

  'candidates.backToCandidates': 'К списку кандидатов',
  'candidates.loading': 'Загрузка кандидата.',
  'candidates.notFoundTitle': 'Этот кандидат не найден.',
  'candidates.editTitle': 'Изменить данные',
  'candidates.saveDetails': 'Сохранить данные',
  'candidates.detailsSaved': 'Данные сохранены.',

  'candidates.statusTitle': 'Статус',
  'candidates.saveStatus': 'Сохранить статус',
  'candidates.statusSaved': 'Статус сохранён.',

  'candidates.suitabilityTitle': 'Пригодность для этого сада',
  'candidates.suitabilityDescription':
    'Проверено по данным, записанным для этого сада, — зимостойкость, освещённость, почва, дренаж и другое. Отсутствующие данные честно показаны как неизвестные, а не как ложное совпадение.',
  'candidates.suitabilityLoading': 'Загрузка оценки пригодности.',
  'candidates.suitabilityNone': 'Оценка пригодности ещё не выполнена.',
  'candidates.suitabilityRecalculate': 'Проверить пригодность',
  'candidates.suitabilityRecalculating': 'Проверка…',
  'candidates.suitabilityEvidence': 'Основание',
  'candidates.suitabilityAssumedValue': 'Предположение: {value}',

  'candidates.convertTitle': 'Преобразовать в растение',
  'candidates.deleteTitle': 'Удалить безвозвратно',
  'candidates.deleteExplanation':
    'Кандидат, его фотографии и оценки пригодности исчезнут насовсем. Архивация вместо этого сохраняет запись и её историю.',
  'candidates.deleteAction': 'Удалить безвозвратно',
  'candidates.deleteConfirm': 'Да, удалить',
  'candidates.deleteCancel': 'Оставить',
  'candidates.convertDescription':
    'Создаёт настоящее растение на основе этого кандидата и помечает кандидата как преобразованного. Это действие необратимо.',
  'candidates.convertAcquisitionDateLabel': 'Дата приобретения',
  'candidates.convertAcquisitionDateTypeLabel': 'Тип приобретения',
  'candidates.convertAcquisitionDateTypeNone': 'Не указано',
  'candidates.convertSubmit': 'Преобразовать в растение',
  'candidates.convertConfirm': 'Преобразовать этого кандидата в настоящее растение в этом саду?',
  'candidates.convertedViewPlant': 'Открыть список растений',
  'candidates.alreadyConverted': 'Этот кандидат уже преобразован и не может быть изменён.',

  'candidates.enum.groupingKind.individual': 'Отдельное растение',
  'candidates.enum.groupingKind.row': 'Ряд',
  'candidates.enum.groupingKind.group': 'Группа',
  'candidates.enum.status.active': 'Активен',
  'candidates.enum.status.converted': 'Преобразован',
  'candidates.enum.status.archived': 'В архиве',
  'candidates.enum.status.rejected': 'Отклонён',
  'candidates.enum.priority.low': 'Низкий',
  'candidates.enum.priority.medium': 'Средний',
  'candidates.enum.priority.high': 'Высокий',

  'candidates.enum.acquisitionDateType.planted': 'Высажено',
  'candidates.enum.acquisitionDateType.sown': 'Посеяно',
  'candidates.enum.acquisitionDateType.acquired': 'Приобретено',

  'candidates.enum.suitabilityAxis.hardiness': 'Зимостойкость',
  'candidates.enum.suitabilityAxis.sunExposure': 'Освещённость',
  'candidates.enum.suitabilityAxis.soilPh': 'pH почвы',
  'candidates.enum.suitabilityAxis.drainage': 'Дренаж',
  'candidates.enum.suitabilityAxis.matureSpace': 'Место для взрослого растения',
  'candidates.enum.suitabilityAxis.growingContext': 'Условия выращивания',
  'candidates.enum.suitabilityAxis.structuralConflict': 'Конфликт с сооружениями',
  'candidates.enum.suitabilityAxis.regulatoryStatus': 'Регуляторный статус',
  'candidates.enum.suitabilityAxis.userPreference': 'Предпочтение',

  'candidates.enum.suitabilityCategory.match': 'Совпадение',
  'candidates.enum.suitabilityCategory.caution': 'Осторожно',
  'candidates.enum.suitabilityCategory.blocker': 'Блокирует',
  'candidates.enum.suitabilityCategory.unknown': 'Неизвестно',
  'candidates.enum.suitabilityCategory.assumption': 'Предположение',

  'candidates.enum.suitabilityUnknownReason.gardenContextMissing':
    'Для сада эти данные ещё не записаны.',
  'candidates.enum.suitabilityUnknownReason.plantFactMissing':
    'Для этого растения пока не известно.',
  'candidates.enum.suitabilityUnknownReason.placementMissing':
    'Для этого кандидата не выбрано размещение.',
};
