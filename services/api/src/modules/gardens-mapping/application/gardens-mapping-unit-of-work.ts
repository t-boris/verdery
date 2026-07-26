/**
 * Transaction boundary for gardens-mapping commands.
 *
 * Every port a command handler needs is bound to the same transaction, so a
 * garden's new state, its owner membership (creation only), its outbox
 * event, its audit record, its sync-change entry, and its idempotency record
 * commit or roll back together — "domain state and its outbox events commit
 * atomically" is not optional here the way the profile-provisioning audit
 * shortcut is. Every garden-lifecycle and map command writes `syncChanges`:
 * this is the platform-level `SyncChangeRecorder` (see
 * `platform/sync/sync-change-recorder.ts`), not a module-local port.
 *
 * Map commands additionally need `mapObjects`, `coordinateSpaces`,
 * `calibrations`, and `revisionJournal` bound to the same transaction — a map
 * command's object write and its revision-journal entry must commit or roll
 * back together exactly like its outbox event and audit record already do.
 * `GeoreferenceRepository` is deliberately absent: no map command mutates
 * georeferencing this pass, so `GetGardenMap` reads it directly off the
 * pooled connection instead, the same way `GetGarden` reads `GardenRepository`.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { AuditLogger } from '../../../platform/audit/audit-logger.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { MediaRepository } from '../../media/public.js';
import type { CalibrationRepository } from './calibration-repository.js';
import type { CoordinateSpaceRepository } from './coordinate-space-repository.js';
import type { GardenRepository } from './garden-repository.js';
import type { InvitationRepository } from './invitation-repository.js';
import type { MapObjectRepository } from './map-object-repository.js';
import type { MembershipRepository } from './membership-repository.js';
import type { OwnershipTransferRepository } from './ownership-transfer-repository.js';
import type { RevisionJournalWriter } from './revision-journal-writer.js';

export interface GardensMappingTransactionContext {
  readonly gardens: GardenRepository;
  readonly memberships: MembershipRepository;
  /** P9A-API-01 — bound to the same transaction as every other port here, so an invitation write and its resulting membership grant commit or roll back together. */
  readonly invitations: InvitationRepository;
  /** P9A-OWNER-01 — bound to the same transaction as `memberships`, so an ownership-transfer row and the two membership role changes it describes commit or roll back together. */
  readonly ownershipTransfers: OwnershipTransferRepository;
  readonly idempotency: IdempotencyStore;
  readonly outbox: OutboxAppender;
  readonly auditLogger: AuditLogger;
  readonly mapObjects: MapObjectRepository;
  readonly coordinateSpaces: CoordinateSpaceRepository;
  readonly calibrations: CalibrationRepository;
  readonly revisionJournal: RevisionJournalWriter;
  readonly syncChanges: SyncChangeRecorder;
  /**
   * The media module's own repository port, bound to this transaction —
   * P6-PLAN-01's imported-background commands validate their `planMediaId`
   * reference through it (`validate-imported-plan-reference.ts`), the exact
   * cross-module precedent `PlantsInventoryTransactionContext.media`
   * already set for plant-photo references.
   */
  readonly media: MediaRepository;
}

export interface GardensMappingUnitOfWork {
  run<T>(work: (context: GardensMappingTransactionContext) => Promise<T>): Promise<T>;
}
