import type { MessageCatalogue } from '../catalogue';

import { russianAccessibilityMessages } from './ru-accessibility';
import { russianCandidatesMessages } from './ru-candidates';
import { russianMapMessages } from './ru-map';
import { russianClientPortalMessages } from './ru-client-portal';
import { russianCollaborationMessages } from './ru-collaboration';
import { russianGardenContextMessages } from './ru-garden-context';
import { russianMediaMessages } from './ru-media';
import { russianCatalogMessages } from './ru-catalog';
import { russianObservationsMessages } from './ru-observations';
import { russianOrganizationsMessages } from './ru-organizations';
import { russianPlantsMessages } from './ru-plants';
import { russianPublicationsMessages } from './ru-publications';
import { russianSeasonalPlanMessages } from './ru-seasonal-plan';
import { russianTaskCollaborationMessages } from './ru-task-collaboration';
import { russianTodayMessages } from './ru-today';

/** Russian message catalogue. Typed against the English catalogue, so it cannot be incomplete. */
export const russianMessages: MessageCatalogue = {
  ...russianTodayMessages,
  ...russianAccessibilityMessages,
  ...russianCollaborationMessages,
  ...russianTaskCollaborationMessages,
  ...russianOrganizationsMessages,
  ...russianClientPortalMessages,
  ...russianSeasonalPlanMessages,
  ...russianCandidatesMessages,
  ...russianMapMessages,
  ...russianCatalogMessages,
  ...russianObservationsMessages,
  ...russianPublicationsMessages,
  ...russianGardenContextMessages,
  'app.name': 'Verdery',
  'app.tagline': 'Живая карта настоящего сада.',
  'app.skipToContent': 'Перейти к содержимому',

  'status.title': 'Состояние сервиса',
  'status.description': 'Текущие результаты проверок работоспособности API Verdery.',
  'status.refresh': 'Проверить снова',
  'status.checking': 'Идёт проверка API.',
  'status.liveness': 'Живость',
  'status.readiness': 'Готовность',
  'status.version': 'Версия {version}',
  'status.stateAlive': 'Процесс работает',
  'status.stateReady': 'Готов обслуживать запросы',
  'status.stateNotReady': 'Не готов обслуживать запросы',
  'status.dependencies': 'Зависимости',
  'status.dependencyAvailable': 'Доступна',
  'status.dependencyUnavailable': 'Недоступна',
  'status.dependenciesEmpty': 'Сервис не сообщил ни одной зависимости.',
  'status.announcementLoading': 'Идёт проверка состояния сервиса.',
  'status.announcementLoaded': 'Состояние сервиса обновлено.',

  'notFound.title': 'Страница не найдена',
  'notFound.description': 'Открытый адрес не соответствует ни одной странице этого приложения.',
  'notFound.backHome': 'Вернуться на начальную страницу',

  'errorBoundary.title': 'Что-то пошло не так',
  'errorBoundary.description':
    'Эту часть приложения не удалось отобразить. Можно повторить попытку, не теряя остальную сессию.',
  'errorBoundary.retry': 'Повторить',
  'errorBoundary.reference': 'Код для поддержки: {reference}',

  'error.title': 'Запрос не выполнен',
  'error.correlation': 'Код для поддержки: {correlationId}',
  'error.requestInvalid': 'Запрос отклонён, потому что не соответствует контракту API.',
  'error.requestTooLarge': 'Запрос превысил допустимый для API размер.',
  'error.idempotencyKeyReused': 'Этот запрос уже использовался для другой команды.',
  'error.unauthenticated': 'Вы не вошли в систему или сессия истекла.',
  'error.forbidden': 'У этой учётной записи нет прав на это действие.',
  'error.staleRevision': 'Запись изменилась до того, как правка была сохранена.',
  'error.rateLimited': 'Отправлено слишком много запросов. Подождите и попробуйте снова.',
  'error.internal': 'Сервис завершился с непредвиденной ошибкой.',
  'error.dependencyUnavailable': 'Сервис, от которого зависит API, временно недоступен.',
  'error.transportFailure': 'Из этого браузера не удалось связаться с API.',
  'error.malformedResponse': 'API вернул ответ, который приложение не может интерпретировать.',
  'error.gardenNotFound': 'Этот сад не найден.',
  'error.gardenStaleRevision':
    'Сад изменился до того, как ваша правка была сохранена. Обновите страницу и попробуйте снова.',
  'error.gardenLifecycleConflict': 'Это действие неприменимо к текущему состоянию сада.',
  'error.mapObjectNotFound': 'Этот объект не найден.',
  'error.mapObjectStaleRevision':
    'Объект изменился до того, как ваша правка была сохранена. Обновите страницу и попробуйте снова.',
  'error.mapObjectLifecycleConflict': 'Это действие неприменимо к текущему состоянию объекта.',
  'error.deletionRecentAuthenticationRequired':
    'Для удаления сада нужен недавний вход. Выйдите, войдите снова и повторите.',
  'error.deletionNotFound': 'Нет удаления, которое можно было бы отменить.',
  'error.deletionAlreadyRequested': 'Удаление для этого уже запрошено.',
  'error.deletionNotRecoverable': 'Срок отмены истёк, это удаление больше нельзя отменить.',
  'error.mediaNotFound': 'Такого файла здесь нет.',
  'error.mediaStaleRevision':
    'Файл изменился, пока вы работали. Обновите страницу и попробуйте снова.',
  'error.mediaUploadStateConflict': 'Загрузка не на той стадии, чтобы это сделать.',
  'error.mediaNotAvailable': 'Файл ещё обрабатывается. Попробуйте через минуту.',
  'error.mediaViewerAccessRestricted': 'Ваш доступ к этому саду не включает этот файл.',
  'error.mediaProcessingJobNotFound': 'Такой задачи обработки здесь нет.',
  'error.mediaReferenced': 'Файл ещё используется в другом месте, поэтому его нельзя удалить.',
  'error.mediaDerivativeNotDeletable':
    'Производные версии удаляются вместе с оригиналом, а не отдельно.',
  'error.planPageNotReady':
    'Страница плана ещё подготавливается. Подождите немного и запустите распознавание снова.',
  'error.platReadingUnavailable': 'Распознавание планов не включено в этом окружении.',
  'error.platReadingFailed':
    'План не удалось прочитать надёжно. Попробуйте снова или обведите участок вручную.',
  'error.aerialTracingUnavailable':
    'Автоматическая трассировка аэрофото не включена в этом окружении.',
  'error.aerialTracingNeedsLocation': 'Сохраните адрес сада перед распознаванием участка.',
  'error.aerialTracingFailed': 'Не удалось определить участок и объекты по этому аэрофото.',
  'error.aerialTracingNeedsLot':
    'Сначала совместите и сохраните ровно один участок из плата, затем ищите объекты по аэрофото.',
  'error.aerialTracingLotTooLarge':
    'Сохранённый участок слишком большой для автоматической трассировки по аэрофото.',
  'error.candidateIdentificationSourceNotReady':
    'Полноразмерное фото ещё подготавливается для распознавания. Повтор выполняется автоматически.',
  'error.candidateIdentificationPhotoMissing':
    'Добавьте фотографию перед распознаванием кандидата.',
  'error.candidateIdentificationNoConfidentMatch':
    'Не удалось уверенно распознать растение по этому фото. Попробуйте другое чёткое фото.',
  'error.notificationNotFound': 'Такого уведомления здесь нет.',
  'error.notificationPreferencesStaleRevision':
    'Настройки уведомлений изменились в другом месте. Обновите страницу и попробуйте снова.',
  'error.exportNotFound': 'Такой выгрузки здесь нет.',
  'error.exportActiveExportExists':
    'Выгрузка уже выполняется. Дождитесь её окончания и запустите следующую.',
  'error.exportRecentAuthenticationRequired':
    'Для выгрузки данных нужен недавний вход. Выйдите, войдите снова и повторите.',
  'error.exportNotDownloadable': 'Эта выгрузка ещё не готова к скачиванию, или её ссылка истекла.',
  'error.unknown': 'Запрос не выполнен по нераспознанной причине.',

  'connectivity.staleTitle': 'Нет подключения',
  'connectivity.staleDescription':
    'Показаны уже загруженные данные. Новые изменения нельзя сохранить, пока подключение не восстановится.',

  'drafts.recoveredTitle': 'Восстановлены несохранённые данные',
  'drafts.recoveredDescription':
    'Это черновик, сохранённый на этом устройстве. Он ещё не отправлен на сервер.',
  'drafts.discard': 'Удалить восстановленный черновик',

  'shell.signOut': 'Выйти',
  'shell.primaryNavLabel': 'Приложение',
  'shell.gardenNavLabel': 'Разделы сада',
  'shell.overviewTab': 'Обзор',
  'shell.mapTab': 'Карта',
  'shell.fieldConsole': 'Рабочая консоль',
  'shell.gardenWorkspace': 'Рабочая область сада',
  'shell.operationsGroup': 'Работа',
  'shell.planGroup': 'План и карта',
  'shell.recordsGroup': 'Записи',
  'shell.administrationGroup': 'Администрирование',

  'auth.orSeparator': 'или',
  'auth.signInTitle': 'Вход в Verdery',
  'auth.signInDescription': 'Войдите, чтобы видеть свои сады и управлять ими.',
  'auth.signInWithGoogle': 'Продолжить с Google',
  'auth.signInWithApple': 'Продолжить с Apple',
  'auth.signInFailed': 'Не удалось войти. Попробуйте снова.',
  'auth.sessionExpired': 'Сессия завершилась. Войдите снова, чтобы продолжить с того же места.',
  'auth.emailLabel': 'Адрес электронной почты',
  'auth.emailSubmit': 'Отправить мне ссылку для входа',
  'auth.emailLinkSent': 'Проверьте почту',
  'auth.emailLinkSentDescription': 'Откройте отправленную нами ссылку, чтобы завершить вход.',
  'auth.completingSignIn': 'Завершение входа.',
  'auth.emailLinkConfirmDescription': 'Подтвердите адрес электронной почты, чтобы завершить вход.',
  'auth.emailLinkInvalid': 'Эта ссылка для входа недействительна или истекла. Запросите новую.',

  'gardens.title': 'Сады',
  'gardens.description': 'Все сады, которыми вы владеете или в которых участвуете.',
  'gardens.loading': 'Загрузка садов.',
  'gardens.retry': 'Повторить',
  'gardens.empty': 'У вас пока нет садов. Создайте первый ниже.',
  'gardens.createTitle': 'Создать сад',
  'gardens.createNameLabel': 'Название сада',
  'gardens.createSubmit': 'Создать сад',
  'gardens.nameRequired': 'Введите название длиной до 120 символов.',
  'gardens.lifecycleActive': 'Активен',
  'gardens.lifecycleArchived': 'В архиве',
  'gardens.restoreDeletion': 'Отменить удаление',
  'gardens.recoveryDeadline': 'Удалится {date}, если не отменить',
  'gardens.lifecycleDeletionRequested': 'Запрошено удаление',
  'gardens.lifecyclePurging': 'Удаляется',
  'gardens.roleOwner': 'Владелец',
  'gardens.roleEditor': 'Редактор',
  'gardens.roleViewer': 'Наблюдатель',
  'gardens.settingsTitle': 'Настройки сада',
  'gardens.backToList': 'К списку садов',
  'gardens.renameTitle': 'Название',
  'gardens.rename': 'Сохранить название',
  'gardens.manageTitle': 'Управление садом',
  'gardens.archive': 'Архивировать сад',
  'gardens.archiveConfirm': 'Архивировать этот сад? Его всё ещё можно будет просматривать.',
  'gardens.requestDeletion': 'Удалить сад',
  'gardens.requestDeletionConfirm':
    'Запросить удаление этого сада? Начнётся процесс удаления с периодом восстановления.',
  'gardens.photosTitle': 'Фотографии',
  'gardens.photosDescription':
    'Загрузите фотографию этого сада. Загрузка идёт напрямую в хранилище, с реальным прогрессом, паузой и возобновлением.',

  'statusBar.disclosure': 'Только планирование — не съёмка',

  'tasks.pageTitle': 'Задачи',
  'tasks.pageDescription': 'Ручные задачи этого сада.',
  'tasks.createTitle': 'Создать задачу',
  'tasks.createSubmit': 'Создать задачу',
  'tasks.titleLabel': 'Название',
  'tasks.titleRequired': 'Введите название длиной до 200 символов.',
  'tasks.notesLabel': 'Заметки',
  'tasks.targetKindLabel': 'Цель',
  'tasks.targetGardenAreaIdLabel': 'Зона сада (ID объекта карты)',
  'tasks.targetPlantIdLabel': 'ID растения',
  'tasks.targetIdRequired': 'Введите ID для этой цели.',
  'tasks.mapObjectIdHint': 'Вставьте идентификатор объекта с карты этого сада.',
  'tasks.dueDateLabel': 'Срок выполнения',
  'tasks.urgencyLabel': 'Срочность',
  'tasks.timeWindowStartLabel': 'Начало периода',
  'tasks.timeWindowEndLabel': 'Конец периода',
  'tasks.originObservationIdLabel': 'ID исходного наблюдения (необязательно)',
  'tasks.recurrenceRuleLabel': 'Правило повторения',
  'tasks.filterLegend': 'Фильтр по статусу',
  'tasks.loading': 'Загрузка задач.',
  'tasks.retry': 'Повторить',
  'tasks.empty': 'Нет задач, соответствующих текущему фильтру.',
  'tasks.dueDateDisplay': 'Срок: {date}',
  'tasks.completedAtDisplay': 'Завершено: {date}',
  'tasks.edit': 'Изменить',
  'tasks.reschedule': 'Перенести срок',
  'tasks.skip': 'Пропустить',
  'tasks.delete': 'Удалить',
  'tasks.deleteConfirm': 'Удалить эту задачу?',
  'tasks.saveEdit': 'Сохранить изменения',
  'tasks.cancelEdit': 'Отмена',
  'tasks.saveReschedule': 'Сохранить срок',
  'tasks.completionNoteLabel': 'Заметка о завершении (необязательно)',
  'tasks.complete': 'Завершить',
  'tasks.dismissReasonLabel': 'Причина (необязательно)',
  'tasks.dismiss': 'Отклонить',

  'tasks.enum.targetKind.garden': 'Весь сад',
  'tasks.enum.targetKind.gardenArea': 'Зона сада',
  'tasks.enum.targetKind.plant': 'Растение',
  'tasks.enum.status.planned': 'Запланировано',
  'tasks.enum.status.suggested': 'Предложено',
  'tasks.enum.status.completed': 'Завершено',
  'tasks.enum.status.skipped': 'Пропущено',
  'tasks.enum.status.dismissed': 'Отклонено',
  'tasks.enum.status.deleted': 'Удалено',
  'tasks.enum.urgency.low': 'Низкая',
  'tasks.enum.urgency.normal': 'Обычная',
  'tasks.enum.urgency.high': 'Высокая',
  'tasks.enum.urgency.urgent': 'Срочная',
  'gardenLocation.addressLabel': 'Адрес',
  'gardenLocation.addressSearch': 'Найти',
  'gardenLocation.addressNoMatches':
    'Ни один адрес не совпал. Проверьте написание или поставьте точку сами.',
  'gardenLocation.addressProviderUnavailable':
    'Адресная служба не ответила. Введите координаты вручную или повторите попытку.',
  'gardenLocation.addressUsOnly': 'Поиск по адресу работает для адресов США.',
  'gardenLocation.precisionStreetAddress': 'Номер дома',
  'gardenLocation.precisionStreet': 'Только улица',
  'gardenLocation.precisionArea': 'Только район',
  'gardenLocation.title': 'Местоположение и север',
  'gardenLocation.description':
    'Где этот сад на Земле и куда направлена его карта. Погода, полушарие и сезонный план читают именно эти данные — без них им не на что опереться.',
  'gardenLocation.loading': 'Загрузка местоположения сада.',
  'gardenLocation.empty': 'У этого сада ещё нет местоположения.',
  'gardenLocation.currentCoordinates': 'Широта, долгота',
  'gardenLocation.currentRotation': 'Север',
  'gardenLocation.currentAccuracy': 'Заявленная точность',
  'gardenLocation.accuracyUnknown': 'Не указана',
  'gardenLocation.degrees': '{degrees}° по часовой стрелке от верха карты',
  'gardenLocation.metres': '±{metres} м',
  'gardenLocation.useMyLocation': 'Использовать моё местоположение',
  'gardenLocation.geolocationUnavailable': 'Этот браузер не умеет сообщать местоположение.',
  'gardenLocation.geolocationRefused':
    'Браузер не сообщил местоположение. Введите координаты вручную.',
  'gardenLocation.latitudeLabel': 'Широта',
  'gardenLocation.longitudeLabel': 'Долгота',
  'gardenLocation.rotationLabel': 'Север, в градусах',
  'gardenLocation.advanced': 'Координаты и север',
  'gardenLocation.rotationHint':
    'Насколько повернуть карту по часовой стрелке, чтобы её верх смотрел на север. Оставьте 0, если карта уже нарисована севером вверх.',
  'gardenLocation.coordinatesInvalid':
    'Широта должна быть от -90 до 90, а долгота — от -180 до 180.',
  'gardenLocation.rotationInvalid': 'Север должен быть от 0 до 360 градусов, не включая 360.',
  'gardenLocation.saved': 'Местоположение сохранено.',
  'gardenLocation.submit': 'Сохранить местоположение',

  ...russianMediaMessages,
  ...russianPlantsMessages,
};
