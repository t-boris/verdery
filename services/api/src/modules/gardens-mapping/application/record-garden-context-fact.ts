/**
 * Records (creates or updates in place) one garden context fact
 * (P9D-CONTEXT-01) — `PUT /gardens/{gardenId}/context/{contextKind}`.
 *
 * Same capability as editing garden map content (`editGardenContent`,
 * `garden-role.ts`): a sun-exposure or drainage declaration is exactly the
 * kind of garden-content edit that capability already governs (`bed_details`
 * carries the same latitude for `soil_notes`) — no new capability is
 * introduced.
 *
 * No `Idempotency-Key`/`If-Match`: this is a last-writer-wins upsert on a
 * single natural key `(gardenId, contextKind)`, the exact reasoning
 * `notification-device-commands.ts`'s header gives for
 * `RegisterNotificationDevice` — a retry or concurrent duplicate with the
 * same body converges on identical stored state and an identical response,
 * so a separate idempotency record would duplicate what the upsert already
 * guarantees. This is a deliberate departure from the rest of
 * gardens-mapping's OWN commands (which mostly guard a revision-tracked
 * aggregate and so DO take both headers): `garden_context_fact` has no
 * append-only side effect and no revision-guarded concurrent-edit
 * requirement the brief asked for, so the closer analog is the
 * notification-devices upsert, not `RenameGarden`/`UpsertMapCalibration`.
 *
 * No outbox event, audit record, or `platform.sync_change` row: this
 * package builds no consumer for any of the three (the brief explicitly
 * defers the `tasks-recommendations` read path to a later work package),
 * and this codebase does not wire that plumbing speculatively — `media`'s
 * own registration commands (`register-media-record.ts`) are the same
 * "write only what has a real consumer today" precedent. `recordedByProfileId`/
 * `recordedAt` on the row itself already carry full who/when provenance
 * without a separate audit trail.
 *
 * Source: implementation-plan.md §18.2, work package P9D-CONTEXT-01;
 * technical-specification.md FR-22 ("Garden Context").
 */

import { generateUuidV7, type Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  GardenContextFact,
  RecordGardenContextFactInput,
} from '../domain/garden-context-fact.js';
import { validateGardenContextFactInput } from '../domain/garden-context-fact.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardenContextFactRepository } from './garden-context-fact-repository.js';

export class RecordGardenContextFact {
  constructor(
    private readonly authorization: GardenAuthorization,
    private readonly facts: GardenContextFactRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: RecordGardenContextFactInput,
  ): Promise<GardenContextFact> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const validated = validateGardenContextFactInput(input);
    const now = this.clock.now();

    return this.facts.recordOrUpdate(generateUuidV7(), gardenId, validated, profileId, now);
  }
}
