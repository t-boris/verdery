/**
 * English messages for task assignment, reassignment, and the shared
 * activity history (P9A-TASK-01).
 *
 * A separate module spread into `en.ts` rather than more lines in it — the
 * same "the main catalogue sits at the repository's 600-line source-file
 * limit" reasoning `en-today.ts`, `en-accessibility.ts`, and
 * `en-collaboration.ts` already document.
 *
 * Source: architecture/web-application-design.md, section "15. Localization";
 * implementation-plan.md work package P9A-TASK-01 / P9A-WEB-01.
 */
export const englishTaskCollaborationMessages = {
  'tasks.assignedToDisplay': 'Assigned to {profileId}',
  'tasks.unassigned': 'Unassigned',
  'tasks.completedByDisplay': 'Completed by {profileId}',
  'tasks.assign': 'Assign',
  'tasks.assign.memberLabel': 'Assign to',
  'tasks.assign.noneOption': 'Unassigned',
  'tasks.assign.optionLabel': '{role} — {profileId}',
  'tasks.assign.save': 'Save assignment',
  'tasks.assign.loadingMembers': 'Loading members…',
  'tasks.assign.role.owner': 'Owner',
  'tasks.assign.role.editor': 'Editor',
  'tasks.assign.role.viewer': 'Viewer',

  'tasks.activity.toggle': 'Activity',
  'tasks.activity.loading': 'Loading activity…',
  'tasks.activity.empty': 'No activity yet.',
  'tasks.activity.actorDisplay': 'By {profileId}',
  'tasks.activity.statusDisplay': 'Status: {status}',
  'tasks.activity.dueDateDisplay': 'New due date: {date}',
  'tasks.activity.assignedDisplay': 'Assigned to {profileId}',
  'tasks.activity.unassignedDisplay': 'Unassigned',
  'tasks.activity.command.createManualTask': 'Created',
  'tasks.activity.command.editTask': 'Edited',
  'tasks.activity.command.rescheduleTask': 'Rescheduled',
  'tasks.activity.command.completeTask': 'Completed',
  'tasks.activity.command.dismissTask': 'Dismissed',
  'tasks.activity.command.skipTask': 'Skipped',
  'tasks.activity.command.deleteTask': 'Deleted',
  'tasks.activity.command.convertRecommendationToTask': 'Converted from a recommendation',
  'tasks.activity.command.assignTask': 'Assignment changed',
} as const;
