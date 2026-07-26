import type { englishTaskCollaborationMessages } from './en-task-collaboration';

/**
 * Russian messages for task assignment, reassignment, and the shared
 * activity history (P9A-TASK-01).
 *
 * Typed against the English module so a missing or invented key is a
 * compile error — the same guarantee `MessageCatalogue` gives the full
 * catalogues, applied at this module's own boundary (`ru-collaboration.ts`
 * follows the identical pattern).
 */
export const russianTaskCollaborationMessages: Readonly<
  Record<keyof typeof englishTaskCollaborationMessages, string>
> = {
  'tasks.assignedToDisplay': 'Назначено: {profileId}',
  'tasks.unassigned': 'Не назначено',
  'tasks.completedByDisplay': 'Завершил(а): {profileId}',
  'tasks.assign': 'Назначить',
  'tasks.assign.memberLabel': 'Назначить на',
  'tasks.assign.noneOption': 'Без назначения',
  'tasks.assign.optionLabel': '{role} — {profileId}',
  'tasks.assign.save': 'Сохранить назначение',
  'tasks.assign.loadingMembers': 'Загрузка участников…',
  'tasks.assign.role.owner': 'Владелец',
  'tasks.assign.role.editor': 'Редактор',
  'tasks.assign.role.viewer': 'Наблюдатель',

  'tasks.activity.toggle': 'История',
  'tasks.activity.loading': 'Загрузка истории…',
  'tasks.activity.empty': 'Пока нет истории.',
  'tasks.activity.actorDisplay': 'Автор: {profileId}',
  'tasks.activity.statusDisplay': 'Статус: {status}',
  'tasks.activity.dueDateDisplay': 'Новый срок: {date}',
  'tasks.activity.assignedDisplay': 'Назначено: {profileId}',
  'tasks.activity.unassignedDisplay': 'Без назначения',
  'tasks.activity.command.createManualTask': 'Создана',
  'tasks.activity.command.editTask': 'Изменена',
  'tasks.activity.command.rescheduleTask': 'Перенесена',
  'tasks.activity.command.completeTask': 'Завершена',
  'tasks.activity.command.dismissTask': 'Отклонена',
  'tasks.activity.command.skipTask': 'Пропущена',
  'tasks.activity.command.deleteTask': 'Удалена',
  'tasks.activity.command.convertRecommendationToTask': 'Преобразована из рекомендации',
  'tasks.activity.command.assignTask': 'Изменено назначение',
};
