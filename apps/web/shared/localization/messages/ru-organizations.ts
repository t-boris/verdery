import type { englishOrganizationsMessages } from './en-organizations';

/**
 * Russian messages for the professional-service domain (P9B-WEB-01).
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `MessageCatalogue` gives the full
 * catalogues, applied at this module's own boundary.
 */
export const russianOrganizationsMessages: Readonly<
  Record<keyof typeof englishOrganizationsMessages, string>
> = {
  'error.organizationNotFound': 'Эта организация не найдена.',
  'error.organizationProfileNotFound': 'По этому идентификатору профиля аккаунт не найден.',
  'error.organizationMembershipNotFound': 'Этот участник организации не найден.',
  'error.organizationMembershipAlreadyExists':
    'У этого профиля уже есть запись об участии в этой организации.',
  'error.organizationLastAdminRequired': 'Это действие оставит организацию без администратора.',
  'error.gardenAssignmentNotFound': 'Это назначение на сад не найдено.',
  'error.gardenAssignmentAlreadyActive':
    'У этого участника уже есть активное назначение на этот сад.',
  'error.gardenAssignmentAssigneeNotMember':
    'Назначить на сад можно только активного участника этой организации.',
  'error.gardenAssignmentInvalidTransition':
    'Это назначение уже достигло другого конечного состояния.',
  'error.clientEngagementNotFound': 'Это обслуживание клиента не найдено.',
  'error.clientEngagementInvalidTransition':
    'Это изменение недопустимо для текущего состояния обслуживания.',

  'organizations.title': 'Организации',
  'organizations.description':
    'Все сервисные организации, которыми вы управляете или в которых работаете.',
  'organizations.loading': 'Загрузка организаций.',
  'organizations.retry': 'Повторить',
  'organizations.empty': 'Вы пока не состоите ни в одной организации. Создайте её ниже.',
  'organizations.createTitle': 'Создать организацию',
  'organizations.createNameLabel': 'Название организации',
  'organizations.createSubmit': 'Создать организацию',
  'organizations.nameRequired': 'Введите название длиной до 120 символов.',
  'organizations.detailTitle': 'Организация',
  'organizations.backToList': 'Назад к организациям',
  'organizations.roleAdmin': 'Администратор',
  'organizations.roleProfessional': 'Специалист',

  'organizations.membersTitle': 'Участники',
  'organizations.membersLoading': 'Загрузка участников.',
  'organizations.membersRetry': 'Повторить',
  'organizations.noDisplayName':
    'Участники показаны по идентификатору аккаунта — у этого приложения пока нет для них отображаемых имён.',
  'organizations.addMemberTitle': 'Добавить участника',
  'organizations.addMemberProfileIdLabel': 'ID профиля',
  'organizations.addMemberProfileIdHint':
    'Для участия в организации нет отдельного приглашения — введите ID аккаунта специалиста, который он сообщит вам напрямую.',
  'organizations.addMemberProfileIdRequired': 'Введите ID профиля.',
  'organizations.addMemberRoleLabel': 'Роль',
  'organizations.addMemberSubmit': 'Добавить участника',
  'organizations.changeRoleLabel': 'Роль',
  'organizations.changeRoleSave': 'Сохранить роль',
  'organizations.changeRoleConfirm': 'Изменить роль этого участника на «{role}»?',
  'organizations.remove': 'Удалить',
  'organizations.removeConfirm': 'Удалить этого участника из организации?',

  'assignments.orgSectionTitle': 'Назначения на сады',
  'assignments.loading': 'Загрузка назначений на сады.',
  'assignments.retry': 'Повторить',
  'assignments.empty': 'Сейчас нет ни одного активного назначения на сад.',
  'assignments.createTitle': 'Назначить участника на сад',
  'assignments.memberLabel': 'Участник',
  'assignments.memberPlaceholder': 'Выберите участника',
  'assignments.noEligibleMembers': 'Прежде чем создавать назначение, добавьте участника.',
  'assignments.gardenIdLabel': 'ID сада',
  'assignments.gardenIdHint':
    'Вставьте идентификатор сада, с которым будет работать этот участник — он виден в адресе страницы настроек этого сада. Каталога садов по названию здесь нет — ID должен сообщить владелец сада.',
  'assignments.roleLabel': 'Роль',
  'assignments.submit': 'Создать назначение',
  'assignments.end': 'Завершить',
  'assignments.endConfirm': 'Завершить это назначение на сад?',
  'assignments.revoke': 'Отозвать',
  'assignments.revokeConfirm': 'Немедленно отозвать это назначение на сад?',
  'assignments.state.active': 'Активно',
  'assignments.state.ended': 'Завершено',
  'assignments.state.revoked': 'Отозвано',

  'assignments.gardenSectionTitle': 'Назначенные специалисты',
  'assignments.gardenSectionDescription':
    'Специалисты сервисных организаций, у которых сейчас есть доступ к этому саду. После завершения или отзыва назначение исчезает из этого списка.',
  'assignments.gardenEmpty': 'Сейчас ни одна организация не назначила специалиста на этот сад.',
  'assignments.organizationIdLabel': 'Организация',
  'assignments.profileIdLabel': 'Специалист',

  'engagements.orgSectionTitle': 'Обслуживание клиентов',
  'engagements.loading': 'Загрузка обслуживания клиентов.',
  'engagements.retry': 'Повторить',
  'engagements.empty': 'Обслуживания клиентов пока нет.',
  'engagements.createTitle': 'Создать обслуживание клиента',
  'engagements.gardenIdLabel': 'ID сада',
  'engagements.gardenIdHint': 'Вставьте идентификатор сада, который охватывает это обслуживание.',
  'engagements.submit': 'Создать обслуживание',
  'engagements.activate': 'Активировать',
  'engagements.activateConfirm':
    'Активировать это обслуживание? Оно станет действующими рабочими отношениями для этого сада.',
  'engagements.end': 'Завершить',
  'engagements.endConfirm': 'Завершить это активное обслуживание?',
  'engagements.revoke': 'Отозвать',
  'engagements.revokeConfirm': 'Отозвать это обслуживание?',
  'engagements.revokeReasonLabel': 'Причина (необязательно)',
  'engagements.state.draft': 'Черновик',
  'engagements.state.active': 'Активно',
  'engagements.state.ended': 'Завершено',
  'engagements.state.revoked': 'Отозвано',
  'engagements.stewardshipResidential': 'Бытовое обслуживание',
  'engagements.notificationsEnabled': 'Уведомления клиента включены',
  'engagements.notificationsDisabled': 'Уведомления клиента выключены',
  'engagements.openUpdates': 'Обновления для клиента',

  'engagements.gardenSectionTitle': 'Обслуживание клиентов',
  'engagements.gardenSectionDescription':
    'Все рабочие отношения этого сада, в любом состоянии — видно только его владельцу.',
  'engagements.gardenEmpty': 'Для этого сада ещё не создано ни одного обслуживания клиента.',
};
