import type { englishCollaborationMessages } from './en-collaboration';

/**
 * Russian messages for garden collaboration administration (P9A-WEB-01).
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `MessageCatalogue` gives the full
 * catalogues, applied at this module's own boundary.
 */
export const russianCollaborationMessages: Readonly<
  Record<keyof typeof englishCollaborationMessages, string>
> = {
  'error.membershipNotFound': 'Этот участник не найден.',
  'error.lastOwnerRequired': 'Это действие оставит сад без владельца.',
  'error.ownerRoleNotAllowed':
    'Для изменения владения используйте повышение или понижение, а не это действие.',
  'error.invitationNotFound': 'Эта ссылка-приглашение недействительна.',
  'error.invitationAlreadyPending':
    'Приглашение для этого адреса уже ожидает подтверждения. Отзовите его перед отправкой нового.',
  'error.invitationExpired': 'Срок действия этого приглашения истёк.',
  'error.invitationRevoked': 'Это приглашение было отозвано.',
  'error.invitationAlreadyAccepted': 'Это приглашение уже использовано.',
  'error.invitationEmailMismatch':
    'Это приглашение адресовано другому адресу электронной почты, а не тому, что указан в этом аккаунте.',
  'error.collaborationRecentAuthenticationRequired':
    'Войдите заново, чтобы подтвердить это действие, затем повторите попытку.',
  'error.targetNotOwner': 'Этот участник сейчас не является владельцем.',
  'error.targetAlreadyOwner': 'Этот участник уже является владельцем.',
  'error.ownershipTransferAlreadyPending':
    'Для этого сада уже ожидает передача владения. Отмените её перед новым запросом.',
  'error.ownershipTransferNotFound': 'Ожидающая передача владения не найдена.',

  'collaborators.title': 'Участники',
  'collaborators.membersTitle': 'Участники',
  'collaborators.loading': 'Загрузка участников.',
  'collaborators.retry': 'Повторить',
  'collaborators.noDisplayName':
    'Участники показаны по идентификатору аккаунта — у этого приложения пока нет для них отображаемых имён.',
  'collaborators.changeRoleLabel': 'Роль',
  'collaborators.changeRoleSave': 'Сохранить роль',
  'collaborators.changeRoleConfirm': 'Изменить роль этого участника на «{role}»?',
  'collaborators.promote': 'Повысить до совладельца',
  'collaborators.promoteConfirm': 'Сделать этого участника совладельцем сада?',
  'collaborators.demote': 'Понизить с владельца',
  'collaborators.demoteConfirm': 'Снять с этого участника права владельца? Он станет «{role}».',
  'collaborators.demoteRoleLabel': 'Новая роль',
  'collaborators.remove': 'Удалить',
  'collaborators.removeConfirm': 'Удалить этого участника из сада?',

  'invitations.inviteTitle': 'Пригласить участника',
  'invitations.roleLabel': 'Роль',
  'invitations.emailLabel': 'Email (необязательно)',
  'invitations.emailHint':
    'Оставьте поле пустым, чтобы создать ссылку, которой сможет воспользоваться кто угодно. Укажите email, чтобы принять приглашение мог только этот подтверждённый адрес.',
  'invitations.submit': 'Создать приглашение',
  'invitations.createdTitle': 'Приглашение создано',
  'invitations.createdDescription':
    'Скопируйте эту ссылку сейчас и передайте её отдельно — повторно она показана не будет.',
  'invitations.linkLabel': 'Ссылка-приглашение',
  'invitations.copy': 'Скопировать ссылку',
  'invitations.copied': 'Скопировано.',
  'invitations.copyFailed':
    'Не удалось скопировать автоматически — выделите ссылку выше и скопируйте её вручную.',
  'invitations.done': 'Готово',
  'invitations.pendingTitle': 'Ожидающие приглашения',
  'invitations.loading': 'Загрузка приглашений.',
  'invitations.retry': 'Повторить',
  'invitations.empty': 'Приглашений пока нет.',
  'invitations.noEmail': 'Доступно всем, у кого есть ссылка',
  'invitations.revoke': 'Отозвать',
  'invitations.revokeConfirm': 'Отозвать это приглашение? Его ссылка перестанет работать.',
  'invitations.state.pending': 'Ожидает',
  'invitations.state.accepted': 'Принято',
  'invitations.state.revoked': 'Отозвано',
  'invitations.state.expired': 'Истекло',

  'invite.title': 'Присоединение к саду',
  'invite.working': 'Принимаем ваше приглашение.',
  'invite.missingToken': 'В этой ссылке отсутствует токен приглашения.',
  'invite.successTitle': 'Готово',
  'invite.successDescription': 'Теперь у вас есть доступ «{role}» к этому саду.',
  'invite.goToGarden': 'Открыть сад',
  'invite.signInFirst': 'Войдите в аккаунт, и это приглашение завершится автоматически.',

  'ownership.requestTitle': 'Передача владения',
  'ownership.requestDescription':
    'Владение перейдёт только после того, как получатель примет передачу. До этого вы остаётесь владельцем со всеми правами.',
  'ownership.targetLabel': 'Новый владелец',
  'ownership.targetPlaceholder': 'Выберите участника',
  'ownership.noEligibleMembers':
    'Прежде чем передавать владение, пригласите ещё одного участника — передача возможна только на существующего редактора или наблюдателя.',
  'ownership.resultingRoleLabel': 'Ваша роль после передачи',
  'ownership.submit': 'Запросить передачу',
  'ownership.loading': 'Загрузка передачи владения.',
  'ownership.retry': 'Повторить',
  'ownership.pendingTitle': 'Ожидающая передача',
  'ownership.pendingDescription':
    'Вы предложили передать владение этим садом. Вы станете «{role}», как только предложение будет принято. До этого ничего не меняется.',
  'ownership.cancel': 'Отменить эту передачу',
  'ownership.cancelConfirm': 'Отменить эту ожидающую передачу владения?',
  'ownership.respondTitle': 'Ответить на передачу владения',
  'ownership.respondDescription': '«{fromProfileId}» предлагает вам стать владельцем этого сада.',
  'ownership.accept': 'Принять владение',
  'ownership.acceptConfirm': 'Принять владение этим садом? Вы станете его владельцем.',
  'ownership.acceptedNotice': 'Теперь вы владелец этого сада.',
  'ownership.decline': 'Отклонить',
  'ownership.declinedNotice': 'Вы отклонили передачу владения.',
  'ownership.noneForYou': 'Это предложение о передаче владения больше недоступно.',
  'ownership.incomingListTitle': 'Входящие предложения о передаче владения',
};
