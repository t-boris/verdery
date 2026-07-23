import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import { registerMediaRecord } from '../../media/public.js';
import type { MediaRecord } from '../../media/public.js';
import { AttachTaskFile } from './attach-task-file.js';
import {
  authorizationGranting,
  buildTask,
  createTasksRecommendationsFakes,
  FakeTasksRecommendationsUnitOfWork,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const TASK_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const NOW = new Date('2026-07-21T10:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function mediaRecord(): MediaRecord {
  return registerMediaRecord(
    MEDIA_ID,
    GARDEN_ID,
    PROFILE_ID,
    'garden_photo',
    'photo.jpg',
    'image/jpeg',
    123_456,
    null,
    null,
    null,
    null,
    NOW,
  );
}

describe('AttachTaskFile', () => {
  it('attaches a real media reference without touching the task revision', async () => {
    const fakes = createTasksRecommendationsFakes();
    fakes.tasks.tasks.set(TASK_ID, buildTask({ id: TASK_ID, gardenId: GARDEN_ID }));
    fakes.media.records.set(MEDIA_ID, mediaRecord());
    const attachTaskFile = new AttachTaskFile(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const attachment = await attachTaskFile.execute(
      TASK_ID,
      PROFILE_ID,
      { mediaId: MEDIA_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(attachment).toMatchObject({ taskId: TASK_ID, mediaId: MEDIA_ID });
    expect(fakes.taskAttachments.attachments.size).toBe(1);
    expect(fakes.revisionJournal.entries).toHaveLength(0);
    expect(fakes.tasks.tasks.get(TASK_ID)?.revision).toBe(1);
    // Not touching `task.revision` does not mean sync stays silent: a
    // sync_change row still records the task at its own (unbumped)
    // revision, so a puller learns a new attachment exists on it.
    expect(fakes.syncChanges.entries).toEqual([
      {
        gardenId: GARDEN_ID,
        recordId: TASK_ID,
        recordType: 'task',
        operation: 'upsert',
        recordRevision: 1,
      },
    ]);
  });

  it('rejects a mediaId that does not resolve to an existing media record', async () => {
    const fakes = createTasksRecommendationsFakes();
    fakes.tasks.tasks.set(TASK_ID, buildTask({ id: TASK_ID, gardenId: GARDEN_ID }));
    const attachTaskFile = new AttachTaskFile(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      attachTaskFile.execute(
        TASK_ID,
        PROFILE_ID,
        { mediaId: MEDIA_ID },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.taskAttachments.attachments.size).toBe(0);
  });
});
