import type { englishPublicationsMessages } from './en-publications';

/**
 * Russian messages for the client-publication domain (P9C-PUBLISH-01).
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `MessageCatalogue` gives the full
 * catalogues, applied at this module's own boundary.
 */
export const russianPublicationsMessages: Readonly<
  Record<keyof typeof englishPublicationsMessages, string>
> = {
  'error.clientUpdateNotFound': 'Это обновление для клиента не найдено.',
  'error.clientUpdatePublisherAccessRequired':
    'Для этого действия нужен доступ публикатора на этом обслуживании. Попросите администратора обслуживания выдать его.',
  'error.clientUpdateEngagementNotActive': 'Это обслуживание не активно.',
  'error.clientUpdateInvalidTransition':
    'Это изменение недопустимо для текущего состояния обновления.',
  'error.clientUpdateSummaryRequired': 'Добавьте краткое описание перед отправкой обновления.',
  'error.clientUpdateItemNotFound': 'Этот элемент не найден в этом обновлении.',
  'error.clientUpdateSelectedItemInvalid': 'Этот элемент больше нельзя выбрать.',
  'error.clientUpdateStaffProfileNotFound': 'По этому идентификатору профиля аккаунт не найден.',
  'error.clientUpdateStaleRevision': 'Это обновление изменилось с момента последней загрузки.',
  'error.publisherGrantNotFound': 'Этот доступ публикатора не найден.',
  'error.publisherGrantAlreadyActive': 'У этого человека уже есть активный доступ публикатора.',
  'error.publisherGrantGranteeNotOrganizationMember':
    'Доступ публикатора можно выдать только активному участнику организации, стоящей за этим обслуживанием.',
  'error.publisherGrantGranteeNotGardenMember':
    'Доступ публикатора можно выдать только активному участнику этого сада.',

  'publications.pageTitle': 'Обновления для клиента',
  'publications.backToList': 'Назад',
  'publications.loading': 'Загрузка обновлений для клиента.',
  'publications.retry': 'Повторить',
  'publications.empty': 'Обновлений для клиента пока нет.',
  'publications.createTitle': 'Начать обновление для клиента',
  'publications.createTitleLabel': 'Заголовок',
  'publications.createSubmit': 'Создать черновик',
  'publications.titleRequired': 'Введите заголовок.',
  'publications.open': 'Открыть',

  'publications.state.internal_draft': 'Внутренний черновик',
  'publications.state.ready_for_client': 'Готово к публикации',
  'publications.state.published': 'Опубликовано',
  'publications.state.withdrawn': 'Отозвано',

  'publications.editTitle': 'Содержание',
  'publications.editTitleLabel': 'Заголовок',
  'publications.editSummaryLabel': 'Краткое описание',
  'publications.editSummaryHint':
    'То, что увидит клиент — обязательно перед отправкой на публикацию.',
  'publications.editSave': 'Сохранить',
  'publications.editSaved': 'Сохранено.',

  'publications.lifecycleTitle': 'Статус',
  'publications.submit': 'Отправить на публикацию',
  'publications.submitConfirm': 'Отправить этот черновик? Он выйдет из внутреннего редактирования.',
  'publications.submitDisabledNoSummary': 'Добавьте краткое описание выше перед отправкой.',
  'publications.publish': 'Опубликовать',
  'publications.publishConfirm':
    'Опубликовать это обновление для клиента сейчас? Будет создана новая, постоянная опубликованная версия.',
  'publications.publishNoteLabel': 'Заметка для хроники (необязательно)',
  'publications.publishNoteHint':
    'Короткая произвольная запись, прикреплённая к этой опубликованной версии, в дополнение к элементам ниже.',
  'publications.withdraw': 'Отозвать',
  'publications.withdrawConfirm': 'Отозвать это опубликованное обновление? Это необратимо.',
  'publications.withdrawReasonLabel': 'Причина (необязательно)',
  'publications.publishedAs': 'Опубликовано как версия {versionNumber}.',

  'publications.itemsTitle': 'Подготовленные элементы',
  'publications.itemsEmpty': 'Пока нет подготовленных элементов.',
  'publications.itemKind.work_log': 'Запись о работе',
  'publications.itemKind.media': 'Фото',
  'publications.itemKind.observation': 'Наблюдение',
  'publications.mediaRole.before': 'До',
  'publications.mediaRole.after': 'После',
  'publications.mediaRole.general': 'Общее',

  'publications.addItemTitle': 'Подготовить элемент',
  'publications.addItemKindLabel': 'Тип',
  'publications.addItemWorkLogLabel': 'Выполненная работа',
  'publications.addItemWorkLogPlaceholder': 'Выберите выполненную работу',
  'publications.addItemNoEligibleWorkLogs':
    'На этом обслуживании пока не зафиксировано ни одной выполненной работы.',
  'publications.addItemDescriptionLabel': 'Описание',
  'publications.addItemMediaRecordIdLabel': 'ID медиафайла',
  'publications.addItemMediaRecordIdHint':
    'Вставьте идентификатор уже загруженного фото — выбора из списка здесь пока нет.',
  'publications.addItemMediaRoleLabel': 'Роль',
  'publications.addItemCaptionLabel': 'Подпись (необязательно)',
  'publications.addItemObservationIdLabel': 'ID наблюдения',
  'publications.addItemObservationIdHint':
    'Вставьте идентификатор существующего наблюдения — выбора из списка здесь пока нет.',
  'publications.addItemOccurredAtLabel': 'Когда',
  'publications.addItemSubmit': 'Подготовить элемент',
  'publications.removeItem': 'Удалить',
  'publications.removeItemConfirm': 'Удалить этот элемент из черновика?',

  'publications.accessTitle': 'Доступ публикатора',
  'publications.accessDescription':
    'Доступ публикатора не связан с администрированием этого обслуживания — выдайте его отдельно, чтобы можно было готовить и публиковать обновления для клиента.',
  'publications.accessLoading': 'Загрузка доступа публикатора.',
  'publications.accessRetry': 'Повторить',
  'publications.accessEmpty': 'Пока никто не получил доступ публикатора на этом обслуживании.',
  'publications.accessGrantTitle': 'Выдать доступ публикатора',
  'publications.accessGrantProfileIdLabel': 'ID профиля',
  'publications.accessGrantProfileIdHint':
    'Введите ID аккаунта человека, который будет готовить и публиковать обновления для клиента.',
  'publications.accessGrantSubmit': 'Выдать доступ',
  'publications.accessRevoke': 'Отозвать',
  'publications.accessRevokeConfirm': 'Отозвать доступ публикатора у этого человека?',
  'publications.accessState.active': 'Активен',
  'publications.accessState.revoked': 'Отозван',
};
