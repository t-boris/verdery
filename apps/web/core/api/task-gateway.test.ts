import type { Task, TaskActivityListResult, TaskListResult } from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient, type FetchLike } from './client';
import { createTaskGateway } from './task-gateway';

const ORIGIN = 'https://api.example.test';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const TASK_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const IDEMPOTENCY_KEY = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function gatewayRecording(response: Response) {
  const recorded: RecordedRequest[] = [];
  const fetchImplementation: FetchLike = (url, init) => {
    recorded.push({ url, init });
    return Promise.resolve(response);
  };

  const client = createApiClient({ origin: ORIGIN, fetchImplementation });
  return { gateway: createTaskGateway(client), recorded };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headersOf(recorded: RecordedRequest): Record<string, string> {
  return recorded.init.headers as Record<string, string>;
}

const TASK: Task = {
  id: TASK_ID,
  gardenId: GARDEN_ID,
  targetKind: 'garden',
  targetGardenAreaMapObjectId: null,
  targetPlantId: null,
  title: 'Water the beds',
  notes: null,
  status: 'planned',
  dueDate: null,
  timeWindowStart: null,
  timeWindowEnd: null,
  recurrenceRule: null,
  urgency: 'normal',
  source: 'manual',
  originObservationId: null,
  originRecommendationId: null,
  revision: 1,
  createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
  createdAt: '2026-07-21T09:00:00Z',
  updatedAt: '2026-07-21T09:00:00Z',
  completedAt: null,
  assignedProfileId: null,
  assignedAt: null,
  completedByProfileId: null,
};

describe('createTaskGateway', () => {
  it('posts the request body and idempotency key on create', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TASK, 201));

    await gateway.create(
      GARDEN_ID,
      { target: { kind: 'garden' }, title: 'Water the beds' },
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['idempotency-key']).toBe(IDEMPOTENCY_KEY);
  });

  it('lists without a status filter', async () => {
    const list: TaskListResult = { items: [TASK] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(list, 200));

    const result = await gateway.list(GARDEN_ID, null);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks`);
    expect(result).toEqual(expect.objectContaining({ ok: true, data: list }));
  });

  it('joins multiple statuses into one comma-separated query parameter', async () => {
    const list: TaskListResult = { items: [] };
    const { gateway, recorded } = gatewayRecording(jsonResponse(list, 200));

    await gateway.list(GARDEN_ID, ['planned', 'suggested']);

    expect(recorded[0]?.url).toBe(
      `${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks?status=planned,suggested`,
    );
  });

  it('sends the quoted revision as If-Match and the idempotency key on edit', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TASK, 200));

    await gateway.edit(GARDEN_ID, TASK_ID, { title: 'Water the new beds' }, 2, IDEMPOTENCY_KEY);

    expect(recorded[0]?.init.method).toBe('PATCH');
    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}`);
    expect(headersOf(recorded[0]!)['if-match']).toBe('"2"');
  });

  it('posts to the reschedule sub-resource', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TASK, 200));

    await gateway.reschedule(GARDEN_ID, TASK_ID, { dueDate: '2026-08-01' }, 3, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}/reschedule`);
    expect(headersOf(recorded[0]!)['if-match']).toBe('"3"');
  });

  it('posts to the complete sub-resource with an optional completion note', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TASK, 200));

    await gateway.complete(GARDEN_ID, TASK_ID, { completionNote: 'Done' }, 4, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}/complete`);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ completionNote: 'Done' });
  });

  it('posts to the dismiss sub-resource with an optional reason', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TASK, 200));

    await gateway.dismiss(GARDEN_ID, TASK_ID, { reason: 'Not needed' }, 5, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}/dismiss`);
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ reason: 'Not needed' });
  });

  it('posts to the skip sub-resource with no request body', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TASK, 200));

    await gateway.skip(GARDEN_ID, TASK_ID, 6, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}/skip`);
    expect(recorded[0]?.init.body).toBeUndefined();
  });

  it('posts to the delete sub-resource rather than sending HTTP DELETE', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TASK, 200));

    await gateway.delete(GARDEN_ID, TASK_ID, 7, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}/delete`);
    expect(recorded[0]?.init.method).toBe('POST');
  });

  it('posts to the attachments sub-resource without an If-Match header', async () => {
    const { gateway, recorded } = gatewayRecording(
      jsonResponse(
        { id: TASK_ID, taskId: TASK_ID, mediaId: TASK_ID, createdAt: TASK.createdAt },
        201,
      ),
    );

    await gateway.attachFile(GARDEN_ID, TASK_ID, { mediaId: TASK_ID }, IDEMPOTENCY_KEY);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}/attachments`);
    expect(headersOf(recorded[0]!)['if-match']).toBeUndefined();
  });

  it('posts to the assign sub-resource with the quoted revision as If-Match', async () => {
    const assigned: Task = { ...TASK, assignedProfileId: PROFILE_ID, assignedAt: TASK.createdAt };
    const { gateway, recorded } = gatewayRecording(jsonResponse(assigned, 200));

    const result = await gateway.assign(
      GARDEN_ID,
      TASK_ID,
      { assigneeProfileId: PROFILE_ID },
      8,
      IDEMPOTENCY_KEY,
    );

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}/assign`);
    expect(recorded[0]?.init.method).toBe('POST');
    expect(headersOf(recorded[0]!)['if-match']).toBe('"8"');
    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({
      assigneeProfileId: PROFILE_ID,
    });
    expect(result).toEqual(expect.objectContaining({ ok: true, data: assigned }));
  });

  it('sends an explicit null assigneeProfileId to unassign', async () => {
    const { gateway, recorded } = gatewayRecording(jsonResponse(TASK, 200));

    await gateway.assign(GARDEN_ID, TASK_ID, { assigneeProfileId: null }, 9, IDEMPOTENCY_KEY);

    expect(JSON.parse(recorded[0]?.init.body as string)).toEqual({ assigneeProfileId: null });
  });

  it('reads the activity sub-resource with no revision or idempotency headers', async () => {
    const activity: TaskActivityListResult = {
      items: [
        {
          revision: 1,
          commandType: 'createManualTask',
          actorProfileId: PROFILE_ID,
          status: null,
          dueDate: null,
          assignedProfileId: null,
          recordedAt: TASK.createdAt,
        },
      ],
    };
    const { gateway, recorded } = gatewayRecording(jsonResponse(activity, 200));

    const result = await gateway.activity(GARDEN_ID, TASK_ID);

    expect(recorded[0]?.url).toBe(`${ORIGIN}/v1/gardens/${GARDEN_ID}/tasks/${TASK_ID}/activity`);
    expect(recorded[0]?.init.method).toBe('GET');
    expect(headersOf(recorded[0]!)['if-match']).toBeUndefined();
    expect(headersOf(recorded[0]!)['idempotency-key']).toBeUndefined();
    expect(result).toEqual(expect.objectContaining({ ok: true, data: activity }));
  });
});
