/**
 * Transaction boundary for gardens-mapping commands.
 *
 * Every port a command handler needs is bound to the same transaction, so a
 * garden's new state, its owner membership (creation only), its outbox
 * event, its audit record, and its idempotency record commit or roll back
 * together — "domain state and its outbox events commit atomically" is not
 * optional here the way the profile-provisioning audit shortcut is.
 *
 * Map commands additionally need `mapObjects`, `coordinateSpaces`,
 * `calibrations`, `revisionJournal`, and `syncChanges` bound to the same
 * transaction — a map command's object write, its revision-journal entry,
 * and its sync-change entry must commit or roll back together exactly like
 * its outbox event and audit record already do.
 * `GeoreferenceRepository` is deliberately absent: no map command mutates
 * georeferencing this pass, so `GetGardenMap` reads it directly off the
 * pooled connection instead, the same way `GetGarden` reads `GardenRepository`.
 *
 * Source: architecture/backend-modular-monolith.md, section "12. Transactions".
 */

import type { AuditLogger } from '../../../platform/audit/audit-logger.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { OutboxAppender } from '../../../platform/outbox/outbox-appender.js';
import type { CalibrationRepository } from './calibration-repository.js';
import type { CoordinateSpaceRepository } from './coordinate-space-repository.js';
import type { GardenRepository } from './garden-repository.js';
import type { MapObjectRepository } from './map-object-repository.js';
import type { MembershipRepository } from './membership-repository.js';
import type { RevisionJournalWriter } from './revision-journal-writer.js';
import type { SyncChangeWriter } from './sync-change-writer.js';

export interface GardensMappingTransactionContext {
  readonly gardens: GardenRepository;
  readonly memberships: MembershipRepository;
  readonly idempotency: IdempotencyStore;
  readonly outbox: OutboxAppender;
  readonly auditLogger: AuditLogger;
  readonly mapObjects: MapObjectRepository;
  readonly coordinateSpaces: CoordinateSpaceRepository;
  readonly calibrations: CalibrationRepository;
  readonly revisionJournal: RevisionJournalWriter;
  readonly syncChanges: SyncChangeWriter;
}

export interface GardensMappingUnitOfWork {
  run<T>(work: (context: GardensMappingTransactionContext) => Promise<T>): Promise<T>;
}
