/**
 * Shared in-memory test doubles for the notifications module. Not a
 * `*.test.ts` file; vitest never runs it as a suite. The idempotency and
 * authorization fakes are the same deliberate module-local copies every
 * sibling module carries (test doubles are not part of any `public.ts`
 * surface — `tasks-recommendations-test-doubles.ts` documents the
 * duplication).
 */

import { ConflictError } from '../../../platform/errors/application-error.js';
import type {
  IdempotencyCheck,
  IdempotencyLookupResult,
  IdempotencyRecordInput,
  IdempotencyStore,
} from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GardenRole, MembershipRepository } from '../../gardens-mapping/public.js';
import type { NotificationDevice } from '../domain/notification-device.js';
import type { NotificationIntent } from '../domain/notification-intent.js';
import { INBOX_VISIBLE_STATES } from '../domain/notification-intent.js';
import type {
  NotificationPreferenceEntry,
  NotificationPreferenceSettings,
} from '../domain/notification-preference.js';
import { UNWRITTEN_PREFERENCE_SETTINGS } from '../domain/notification-preference.js';
import type { CandidateFreshnessFacts } from '../domain/notification-policy.js';
import type { GardenRecipient, GardenRecipientSource } from './garden-recipient-source.js';
import type {
  NewDeliveryAttempt,
  NotificationDeliveryRepository,
} from './notification-delivery-repository.js';
import type {
  NotificationDeviceRegistration,
  NotificationDeviceRepository,
} from './notification-device-repository.js';
import type {
  NewNotificationIntent,
  NotificationIntentRepository,
} from './notification-intent-repository.js';
import type {
  NotificationPreferenceRepository,
  PreferenceDocumentReplacement,
} from './notification-preference-repository.js';
import type { PushMessage, PushMessageSender, PushSendOutcome } from './push-message-sender.js';
import type { RecommendationFreshnessSource } from './recommendation-freshness-source.js';
import type {
  NotificationsTransactionContext,
  NotificationsUnitOfWork,
} from './notifications-unit-of-work.js';

export function fixedClock(at: Date): Clock {
  return { now: () => at };
}

/** In-memory mirror of `KyselyNotificationIntentRepository`'s semantics — dedup insert, state-conditional closes, convergent set-once stamps. */
export class FakeNotificationIntentRepository implements NotificationIntentRepository {
  readonly rows = new Map<Uuid, NotificationIntent>();

  insertIfAbsent(intent: NewNotificationIntent, now: Date): Promise<boolean> {
    for (const row of this.rows.values()) {
      if (
        row.recipientProfileId === intent.recipientProfileId &&
        row.dedupKey === intent.dedupKey
      ) {
        return Promise.resolve(false);
      }
    }
    this.rows.set(intent.id, {
      ...intent,
      state: 'pending',
      closeReason: null,
      nextDeliveryAttemptAt: null,
      deliveryAttemptCount: 0,
      readAt: null,
      dismissedAt: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    return Promise.resolve(true);
  }

  closePendingForCandidate(candidateId: Uuid, now: Date): Promise<number> {
    let closed = 0;
    for (const [id, row] of this.rows) {
      if (row.recommendationCandidateId === candidateId && row.state === 'pending') {
        this.rows.set(id, {
          ...row,
          state: 'superseded',
          revision: row.revision + 1,
          updatedAt: now,
        });
        closed += 1;
      }
    }
    return Promise.resolve(closed);
  }

  expirePendingForRecipient(recipientProfileId: Uuid, now: Date): Promise<number> {
    let expired = 0;
    for (const [id, row] of this.rows) {
      if (
        row.recipientProfileId === recipientProfileId &&
        row.state === 'pending' &&
        row.expiresAt.getTime() <= now.getTime()
      ) {
        this.rows.set(id, { ...row, state: 'expired', revision: row.revision + 1, updatedAt: now });
        expired += 1;
      }
    }
    return Promise.resolve(expired);
  }

  listInboxPage(
    recipientProfileId: Uuid,
    beforeId: Uuid | null,
    limit: number,
    now: Date,
  ): Promise<readonly NotificationIntent[]> {
    const rows = [...this.rows.values()]
      .filter(
        (row) =>
          row.recipientProfileId === recipientProfileId &&
          INBOX_VISIBLE_STATES.includes(row.state) &&
          row.channelInApp &&
          row.dismissedAt === null &&
          row.expiresAt.getTime() > now.getTime() &&
          (beforeId === null || row.id < beforeId),
      )
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, limit);
    return Promise.resolve(rows);
  }

  findForRecipient(id: Uuid, recipientProfileId: Uuid): Promise<NotificationIntent | null> {
    const row = this.rows.get(id);
    return Promise.resolve(
      row !== undefined && row.recipientProfileId === recipientProfileId ? row : null,
    );
  }

  markRead(id: Uuid, recipientProfileId: Uuid, now: Date): Promise<NotificationIntent | null> {
    return this.stampOnce(id, recipientProfileId, 'readAt', now);
  }

  markDismissed(id: Uuid, recipientProfileId: Uuid, now: Date): Promise<NotificationIntent | null> {
    return this.stampOnce(id, recipientProfileId, 'dismissedAt', now);
  }

  private stampOnce(
    id: Uuid,
    recipientProfileId: Uuid,
    field: 'readAt' | 'dismissedAt',
    now: Date,
  ): Promise<NotificationIntent | null> {
    const row = this.rows.get(id);
    if (row === undefined || row.recipientProfileId !== recipientProfileId) {
      return Promise.resolve(null);
    }
    if (row[field] !== null) {
      return Promise.resolve(row);
    }
    const updated = { ...row, [field]: now, revision: row.revision + 1, updatedAt: now };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

/** In-memory mirror of `KyselyNotificationPreferenceRepository`, including the revision-guarded whole-document replacement. */
export class FakeNotificationPreferenceRepository implements NotificationPreferenceRepository {
  readonly settingsByProfile = new Map<Uuid, NotificationPreferenceSettings>();
  readonly entriesByProfile = new Map<Uuid, readonly NotificationPreferenceEntry[]>();

  getSettings(profileId: Uuid): Promise<NotificationPreferenceSettings> {
    return Promise.resolve(this.settingsByProfile.get(profileId) ?? UNWRITTEN_PREFERENCE_SETTINGS);
  }

  listEntries(profileId: Uuid): Promise<readonly NotificationPreferenceEntry[]> {
    return Promise.resolve(this.entriesByProfile.get(profileId) ?? []);
  }

  getSettingsForProfiles(
    profileIds: readonly Uuid[],
  ): Promise<ReadonlyMap<Uuid, NotificationPreferenceSettings>> {
    const map = new Map<Uuid, NotificationPreferenceSettings>();
    for (const profileId of profileIds) {
      const settings = this.settingsByProfile.get(profileId);
      if (settings !== undefined) {
        map.set(profileId, settings);
      }
    }
    return Promise.resolve(map);
  }

  listEntriesForProfiles(
    profileIds: readonly Uuid[],
    notificationType: string,
  ): Promise<ReadonlyMap<Uuid, readonly NotificationPreferenceEntry[]>> {
    const map = new Map<Uuid, readonly NotificationPreferenceEntry[]>();
    for (const profileId of profileIds) {
      const entries = (this.entriesByProfile.get(profileId) ?? []).filter(
        (entry) => entry.notificationType === notificationType,
      );
      if (entries.length > 0) {
        map.set(profileId, entries);
      }
    }
    return Promise.resolve(map);
  }

  replaceDocument(
    profileId: Uuid,
    expectedRevision: number,
    replacement: PreferenceDocumentReplacement,
    _now: Date,
  ): Promise<number | null> {
    const current = this.settingsByProfile.get(profileId);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expectedRevision) {
      return Promise.resolve(null);
    }
    const revision = currentRevision + 1;
    this.settingsByProfile.set(profileId, {
      quietHours: replacement.quietHours,
      quietHoursTimeZone: replacement.quietHoursTimeZone,
      revision,
    });
    this.entriesByProfile.set(profileId, [...replacement.entries]);
    return Promise.resolve(revision);
  }
}

export class FakeGardenRecipientSource implements GardenRecipientSource {
  readonly recipientsByGarden = new Map<Uuid, readonly GardenRecipient[]>();

  listActiveMembers(gardenId: Uuid): Promise<readonly GardenRecipient[]> {
    return Promise.resolve(this.recipientsByGarden.get(gardenId) ?? []);
  }

  findActiveMember(gardenId: Uuid, profileId: Uuid): Promise<GardenRecipient | null> {
    const member = (this.recipientsByGarden.get(gardenId) ?? []).find(
      (recipient) => recipient.profileId === profileId,
    );
    return Promise.resolve(member ?? null);
  }
}

export class FakeRecommendationFreshnessSource implements RecommendationFreshnessSource {
  readonly candidates = new Map<Uuid, CandidateFreshnessFacts>();

  findCandidate(candidateId: Uuid): Promise<CandidateFreshnessFacts | null> {
    return Promise.resolve(this.candidates.get(candidateId) ?? null);
  }
}

/** In-memory mirror of `KyselyNotificationDeviceRepository`'s semantics — token displacement, reactivating upsert, idempotent disable. */
export class FakeNotificationDeviceRepository implements NotificationDeviceRepository {
  readonly rows = new Map<Uuid, NotificationDevice>();

  registerOrRefresh(
    registration: NotificationDeviceRegistration,
    now: Date,
  ): Promise<NotificationDevice> {
    for (const [id, row] of this.rows) {
      if (
        row.fcmToken === registration.fcmToken &&
        (row.profileId !== registration.profileId ||
          row.installationId !== registration.installationId)
      ) {
        this.rows.delete(id);
      }
    }

    const existing = [...this.rows.values()].find(
      (row) =>
        row.profileId === registration.profileId &&
        row.installationId === registration.installationId,
    );

    const device: NotificationDevice = {
      id: existing?.id ?? registration.id,
      profileId: registration.profileId,
      installationId: registration.installationId,
      platform: registration.platform,
      provider: registration.provider,
      fcmToken: registration.fcmToken,
      environment: registration.environment,
      status: 'active',
      disabledReason: null,
      lastSeenAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(device.id, device);
    return Promise.resolve(device);
  }

  remove(profileId: Uuid, installationId: Uuid): Promise<boolean> {
    for (const [id, row] of this.rows) {
      if (row.profileId === profileId && row.installationId === installationId) {
        this.rows.delete(id);
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  listActiveForProfile(profileId: Uuid): Promise<readonly NotificationDevice[]> {
    const rows = [...this.rows.values()]
      .filter((row) => row.profileId === profileId && row.status === 'active')
      .sort((a, b) => a.id.localeCompare(b.id));
    return Promise.resolve(rows);
  }

  disable(deviceId: Uuid, reason: string, now: Date): Promise<boolean> {
    const row = this.rows.get(deviceId);
    if (row === undefined || row.status !== 'active') {
      return Promise.resolve(false);
    }
    this.rows.set(deviceId, { ...row, status: 'disabled', disabledReason: reason, updatedAt: now });
    return Promise.resolve(true);
  }
}

/**
 * In-memory mirror of `KyselyNotificationDeliveryRepository` over the SAME
 * rows as the intent fake (constructed with it), so a sweep test observes
 * one consistent store.
 */
export class FakeNotificationDeliveryRepository implements NotificationDeliveryRepository {
  readonly attempts: NewDeliveryAttempt[] = [];

  constructor(private readonly intents: FakeNotificationIntentRepository) {}

  claimDueForDelivery(
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<readonly NotificationIntent[]> {
    const due = [...this.intents.rows.values()]
      .filter(
        (row) =>
          row.state === 'pending' &&
          row.channelPush &&
          row.earliestDeliveryAt.getTime() <= now.getTime() &&
          (row.nextDeliveryAttemptAt === null ||
            row.nextDeliveryAttemptAt.getTime() <= now.getTime()) &&
          row.expiresAt.getTime() > now.getTime(),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit);

    const claimed = due.map((row) => ({
      ...row,
      nextDeliveryAttemptAt: leaseUntil,
      revision: row.revision + 1,
      updatedAt: now,
    }));
    for (const row of claimed) {
      this.intents.rows.set(row.id, row);
    }
    return Promise.resolve(claimed);
  }

  expireDuePending(now: Date, limit: number): Promise<number> {
    const due = [...this.intents.rows.values()]
      .filter((row) => row.state === 'pending' && row.expiresAt.getTime() <= now.getTime())
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit);
    for (const row of due) {
      this.intents.rows.set(row.id, {
        ...row,
        state: 'expired',
        revision: row.revision + 1,
        updatedAt: now,
      });
    }
    return Promise.resolve(due.length);
  }

  markSent(id: Uuid, attemptCount: number, now: Date): Promise<boolean> {
    return this.updatePending(id, (row) => ({
      ...row,
      state: 'sent',
      deliveryAttemptCount: attemptCount,
      revision: row.revision + 1,
      updatedAt: now,
    }));
  }

  closeDelivery(
    id: Uuid,
    state: 'failed' | 'skipped' | 'expired',
    reason: string | null,
    now: Date,
  ): Promise<boolean> {
    return this.updatePending(id, (row) => ({
      ...row,
      state,
      closeReason: reason,
      revision: row.revision + 1,
      updatedAt: now,
    }));
  }

  scheduleRetry(id: Uuid, nextAttemptAt: Date, attemptCount: number, now: Date): Promise<boolean> {
    return this.updatePending(id, (row) => ({
      ...row,
      nextDeliveryAttemptAt: nextAttemptAt,
      deliveryAttemptCount: attemptCount,
      revision: row.revision + 1,
      updatedAt: now,
    }));
  }

  recordAttempts(attempts: readonly NewDeliveryAttempt[]): Promise<void> {
    this.attempts.push(...attempts);
    return Promise.resolve();
  }

  private updatePending(
    id: Uuid,
    update: (row: NotificationIntent) => NotificationIntent,
  ): Promise<boolean> {
    const row = this.intents.rows.get(id);
    if (row === undefined || row.state !== 'pending') {
      return Promise.resolve(false);
    }
    this.intents.rows.set(id, update(row));
    return Promise.resolve(true);
  }
}

/** Scripted FCM fake: outcomes are queued per token; unscripted tokens accept. Records every message so tests assert payloads without a live provider. */
export class FakePushMessageSender implements PushMessageSender {
  readonly sent: PushMessage[] = [];
  private readonly scripted = new Map<string, PushSendOutcome[]>();

  scriptOutcome(token: string, outcome: PushSendOutcome): void {
    const queue = this.scripted.get(token) ?? [];
    queue.push(outcome);
    this.scripted.set(token, queue);
  }

  send(message: PushMessage): Promise<PushSendOutcome> {
    this.sent.push(message);
    const queue = this.scripted.get(message.token);
    const outcome = queue?.shift();
    return Promise.resolve(
      outcome ?? { kind: 'accepted', providerMessageId: `fake-${String(this.sent.length)}` },
    );
  }
}

interface StoredIdempotencyRecord {
  readonly input: IdempotencyRecordInput;
  readonly responseStatusCode: number;
  readonly responseBody: unknown;
}

/** In-memory stand-in for `KyselyIdempotencyStore` — the sibling modules' own shape, duplicated locally by the header's reasoning. */
export class FakeIdempotencyStore implements IdempotencyStore {
  readonly saved: StoredIdempotencyRecord[] = [];

  private matchKey(input: IdempotencyRecordInput): string {
    return `${input.actorProfileId}:${input.operation}:${input.idempotencyKey}`;
  }

  check(input: IdempotencyRecordInput): Promise<IdempotencyCheck> {
    const existing = this.saved.find(
      (record) => this.matchKey(record.input) === this.matchKey(input),
    );

    if (existing === undefined) {
      return Promise.resolve({ kind: 'new' });
    }

    if (existing.input.requestFingerprint !== input.requestFingerprint) {
      return Promise.reject(
        new ConflictError(
          'request.idempotency.key_reused',
          'This idempotency key was already used with a different request.',
        ),
      );
    }

    return Promise.resolve({
      kind: 'replay',
      responseStatusCode: existing.responseStatusCode,
      responseBody: existing.responseBody,
    });
  }

  save(
    input: IdempotencyRecordInput,
    responseStatusCode: number,
    responseBody: unknown,
  ): Promise<void> {
    this.saved.push({ input, responseStatusCode, responseBody });
    return Promise.resolve();
  }

  lookup(
    actorProfileId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<IdempotencyLookupResult | null> {
    const existing = this.saved.find(
      (record) =>
        this.matchKey(record.input) ===
        this.matchKey({ actorProfileId, operation, idempotencyKey, requestFingerprint: '' }),
    );

    return Promise.resolve(
      existing === undefined
        ? null
        : { responseStatusCode: existing.responseStatusCode, responseBody: existing.responseBody },
    );
  }
}

export interface FakeMembership {
  readonly id: string;
  readonly gardenId: Uuid;
  readonly profileId: Uuid;
  readonly role: GardenRole;
}

class FakeMembershipRepository implements MembershipRepository {
  constructor(private readonly membership: FakeMembership | null) {}

  findActiveMembership(): ReturnType<MembershipRepository['findActiveMembership']> {
    return Promise.resolve(this.membership);
  }

  insertOwner(): Promise<void> {
    throw new Error('not used by this test');
  }

  listMembershipsForProfile(): ReturnType<MembershipRepository['listMembershipsForProfile']> {
    throw new Error('not used by this test');
  }
}

/** A real `GardenAuthorization` over a fake membership — the sibling modules' own construction. */
export function authorizationGranting(membership: FakeMembership): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(membership));
}

export function authorizationDenying(): GardenAuthorization {
  return new GardenAuthorization(new FakeMembershipRepository(null));
}

export interface NotificationsFakes {
  readonly intents: FakeNotificationIntentRepository;
  readonly preferences: FakeNotificationPreferenceRepository;
  readonly recipients: FakeGardenRecipientSource;
  readonly recommendationFreshness: FakeRecommendationFreshnessSource;
  readonly idempotency: FakeIdempotencyStore;
  readonly devices: FakeNotificationDeviceRepository;
  readonly delivery: FakeNotificationDeliveryRepository;
}

export function createNotificationsFakes(): NotificationsFakes {
  const intents = new FakeNotificationIntentRepository();
  return {
    intents,
    preferences: new FakeNotificationPreferenceRepository(),
    recipients: new FakeGardenRecipientSource(),
    recommendationFreshness: new FakeRecommendationFreshnessSource(),
    idempotency: new FakeIdempotencyStore(),
    devices: new FakeNotificationDeviceRepository(),
    delivery: new FakeNotificationDeliveryRepository(intents),
  };
}

/** Runs the work directly against the fakes — no transaction semantics to emulate for unit tests. */
export class FakeNotificationsUnitOfWork implements NotificationsUnitOfWork {
  constructor(private readonly fakes: NotificationsFakes) {}

  run<T>(work: (context: NotificationsTransactionContext) => Promise<T>): Promise<T> {
    return work(this.fakes);
  }
}
