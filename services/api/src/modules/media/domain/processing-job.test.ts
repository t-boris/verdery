import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import {
  createProcessingJob,
  isProcessingJobTerminal,
  markProcessingJobCancelled,
  markProcessingJobExpired,
  markProcessingJobFailedRetryable,
  markProcessingJobFailedTerminal,
  markProcessingJobPartial,
  markProcessingJobQueued,
  markProcessingJobRunning,
  markProcessingJobSucceeded,
  retryProcessingJob,
} from './processing-job.js';

const JOB_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a01';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a02';
const T0 = new Date('2026-07-21T09:00:00Z');
const T1 = new Date('2026-07-21T09:05:00Z');

function requested(now = T0) {
  return createProcessingJob(
    { id: JOB_ID, mediaId: MEDIA_ID, processorConfigVersion: 'v1', inputChecksums: [] },
    now,
  );
}

const RESULT = { outcomeCode: 'ok', resultSummary: { note: 'placeholder' } };

describe('createProcessingJob', () => {
  it('starts requested, attempt 1, revision 1, with no result yet', () => {
    const job = requested();

    expect(job).toMatchObject({
      id: JOB_ID,
      mediaId: MEDIA_ID,
      jobKind: 'derivative_generation',
      state: 'requested',
      attempt: 1,
      revision: 1,
      outcomeCode: null,
      queuedAt: null,
      completedAt: null,
    });
    expect(isProcessingJobTerminal(job)).toBe(false);
  });

  it('accepts an explicit job kind and trace id', () => {
    const job = createProcessingJob(
      {
        id: JOB_ID,
        mediaId: MEDIA_ID,
        processorConfigVersion: 'v1',
        inputChecksums: ['abc'],
        jobKind: 'validation',
        traceId: 'trace-1',
      },
      T0,
    );

    expect(job.jobKind).toBe('validation');
    expect(job.traceId).toBe('trace-1');
    expect(job.inputChecksums).toEqual(['abc']);
  });
});

describe('markProcessingJobQueued', () => {
  it('requested -> queued, bumping revision and setting queuedAt', () => {
    const queued = markProcessingJobQueued(requested(), T1);

    expect(queued.state).toBe('queued');
    expect(queued.queuedAt).toEqual(T1);
    expect(queued.revision).toBe(2);
  });

  it('rejects a job that is not requested', () => {
    const queued = markProcessingJobQueued(requested(), T1);
    expect(() => markProcessingJobQueued(queued, T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('markProcessingJobRunning', () => {
  it('queued -> running', () => {
    const queued = markProcessingJobQueued(requested(), T0);
    const running = markProcessingJobRunning(queued, T1);
    expect(running.state).toBe('running');
  });

  it('rejects from requested directly', () => {
    expect(() => markProcessingJobRunning(requested(), T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('terminal transitions from queued or running', () => {
  const queued = () => markProcessingJobQueued(requested(), T0);
  const running = () => markProcessingJobRunning(queued(), T0);

  it('succeeded records the result and completedAt, and is terminal', () => {
    const succeeded = markProcessingJobSucceeded(queued(), RESULT, T1);
    expect(succeeded.state).toBe('succeeded');
    expect(succeeded.outcomeCode).toBe('ok');
    expect(succeeded.completedAt).toEqual(T1);
    expect(isProcessingJobTerminal(succeeded)).toBe(true);
  });

  it('succeeded also reachable from running', () => {
    const succeeded = markProcessingJobSucceeded(running(), RESULT, T1);
    expect(succeeded.state).toBe('succeeded');
  });

  it('partial, failed_terminal, and cancelled are each reachable and terminal', () => {
    expect(markProcessingJobPartial(queued(), RESULT, T1).state).toBe('partial');
    expect(markProcessingJobFailedTerminal(queued(), RESULT, T1).state).toBe('failed_terminal');
    expect(markProcessingJobCancelled(queued(), RESULT, T1).state).toBe('cancelled');
    expect(isProcessingJobTerminal(markProcessingJobPartial(queued(), RESULT, T1))).toBe(true);
  });

  it('failed_retryable is reachable but not terminal', () => {
    const failed = markProcessingJobFailedRetryable(queued(), RESULT, T1);
    expect(failed.state).toBe('failed_retryable');
    expect(isProcessingJobTerminal(failed)).toBe(false);
  });

  it('rejects a terminal transition from requested', () => {
    expect(() => markProcessingJobSucceeded(requested(), RESULT, T1)).toThrow(
      DomainRuleViolatedError,
    );
  });

  it('rejects a second terminal transition on an already-terminal job', () => {
    const succeeded = markProcessingJobSucceeded(queued(), RESULT, T1);
    expect(() => markProcessingJobSucceeded(succeeded, RESULT, T1)).toThrow(
      DomainRuleViolatedError,
    );
  });
});

describe('retryProcessingJob', () => {
  it('failed_retryable -> queued, incrementing attempt and clearing the previous outcome', () => {
    const failed = markProcessingJobFailedRetryable(
      markProcessingJobQueued(requested(), T0),
      RESULT,
      T0,
    );
    const retried = retryProcessingJob(failed, T1);

    expect(retried.state).toBe('queued');
    expect(retried.attempt).toBe(2);
    expect(retried.outcomeCode).toBeNull();
    expect(retried.completedAt).toBeNull();
  });

  it('rejects retrying a job that is not failed_retryable', () => {
    expect(() => retryProcessingJob(requested(), T1)).toThrow(DomainRuleViolatedError);
  });
});

describe('markProcessingJobExpired', () => {
  it('queued -> expired', () => {
    const queued = markProcessingJobQueued(requested(), T0);
    const expired = markProcessingJobExpired(queued, T1);
    expect(expired.state).toBe('expired');
    expect(expired.outcomeCode).toBe('expired');
    expect(isProcessingJobTerminal(expired)).toBe(true);
  });

  it('rejects expiring a running job — the diagram draws this edge only from queued', () => {
    const running = markProcessingJobRunning(markProcessingJobQueued(requested(), T0), T0);
    expect(() => markProcessingJobExpired(running, T1)).toThrow(DomainRuleViolatedError);
  });
});
