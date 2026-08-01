import type { englishClientPortalMessages } from './en-client-portal';

/**
 * Russian messages for the client-portal domain (P9C-WEB-01).
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `MessageCatalogue` gives the full
 * catalogues, applied at this module's own boundary.
 */
export const russianClientPortalMessages: Readonly<
  Record<keyof typeof englishClientPortalMessages, string>
> = {
  'error.clientAccessGrantNotFound': 'Это приглашение не найдено.',
  'error.clientAccessGrantAlreadyOutstanding':
    'Приглашение для этого адреса электронной почты по этому обслуживанию уже отправлено.',
  'error.clientAccessGrantExpired': 'Срок действия этого приглашения истёк.',
  'error.clientAccessGrantRevoked': 'Это приглашение было отозвано.',
  'error.clientAccessGrantAlreadyAccepted': 'Это приглашение уже принято.',
  'error.clientAccessGrantEmailMismatch':
    'Это приглашение отправлено на другой адрес электронной почты, отличный от того, с которым вы вошли.',
  'error.clientAccessGrantEngagementNotInvitable':
    'Это обслуживание сейчас не принимает приглашения.',
  'error.clientAccessGrantEngagementNotActive': 'Это обслуживание сейчас не активно.',
  'error.clientAccessGrantInvalidTransition':
    'Это приглашение уже достигло другого конечного состояния.',
  'error.clientGardenNotFound': 'Этот сад не найден.',

  'clientPortal.shellPrimaryNavLabel': 'Клиентский портал',
  'clientPortal.myGardens': 'Мои сады',
  'clientPortal.gardenNavLabel': 'Разделы сада',
  'clientPortal.overviewTab': 'Обзор',
  'clientPortal.publicationsTab': 'Обновления',
  'clientPortal.timelineTab': 'Хронология',

  'clientPortal.gardensTitle': 'Мои сады',
  'clientPortal.gardensDescription': 'Каждый сад, с которым у вас есть активная связь.',
  'clientPortal.gardensLoading': 'Загрузка ваших садов.',
  'clientPortal.gardensRetry': 'Повторить',
  'clientPortal.gardensEmpty': 'У вас пока нет активных связей с садами.',

  'clientPortal.overviewTitle': 'Обзор сада',
  'clientPortal.overviewLoading': 'Загрузка обзора сада.',
  'clientPortal.overviewRetry': 'Повторить',
  'clientPortal.overviewEmpty': 'Для этого сада пока ничего не опубликовано.',
  'clientPortal.overviewAsOf': 'По состоянию на {date}',
  'clientPortal.overviewPublishedAt': 'Опубликовано {date}',

  'clientPortal.publicationsTitle': 'Обновления',
  'clientPortal.publicationsDescription':
    'Каждое обновление, опубликованное для этого сада, сначала самое новое.',
  'clientPortal.publicationsLoading': 'Загрузка обновлений.',
  'clientPortal.publicationsRetry': 'Повторить',
  'clientPortal.publicationsEmpty': 'Для этого сада пока не опубликовано ни одного обновления.',
  'clientPortal.publicationVersionLabel': 'Обновление {version}',
  'clientPortal.publicationPublishedAt': 'Опубликовано {date}',
  'clientPortal.staffAttributionsTitle': 'Команда',

  'clientPortal.timelineTitle': 'Хронология сада',
  'clientPortal.timelineDescription':
    'Фактическая хронологическая запись событий в этом саду, сначала самые старые.',
  'clientPortal.timelineLoading': 'Загрузка хронологии сада.',
  'clientPortal.timelineRetry': 'Повторить',
  'clientPortal.timelineEmpty': 'Для этого сада пока нет записанной истории.',

  'clientPortal.kindWorkLog': 'Выполненная работа',
  'clientPortal.kindMedia': 'Фото',
  'clientPortal.kindGardenSnapshot': 'Обзор сада',
  'clientPortal.kindTimelineEntry': 'Заметка',
  'clientPortal.kindObservation': 'Заметка о развитии',

  'clientPortal.mediaRoleBefore': 'До',
  'clientPortal.mediaRoleAfter': 'После',
  'clientPortal.mediaRoleGeneral': 'Фото',
  'clientPortal.mediaLoading': 'Загрузка фото.',
  'clientPortal.mediaAlt': 'Фото «{role}»',

  'clientPortal.inviteTitle': 'Принять приглашение',
  'clientPortal.inviteWorking': 'Проверяем ваше приглашение.',
  'clientPortal.inviteMissingToken': 'В этой ссылке отсутствует токен приглашения.',
  'clientPortal.inviteSuccessTitle': 'Приглашение принято',
  'clientPortal.inviteSuccessDescription':
    'Теперь у вас есть доступ к опубликованным обновлениям этого сада.',
  'clientPortal.inviteGoToGardens': 'Перейти к моим садам',
};
