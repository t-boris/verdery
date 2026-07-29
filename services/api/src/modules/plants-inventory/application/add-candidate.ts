import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GroupingKind } from '../domain/plant.js';
import type { CandidatePlacement, CandidatePriority } from '../domain/plant-candidate.js';
import { createCandidate } from '../domain/plant-candidate.js';
import type { PlantsInventoryUnitOfWork } from './plants-inventory-unit-of-work.js';
import { requireCandidatePlacementReferencesGardenObjects } from './require-candidate-placement-in-garden.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'plants.addCandidate';

export interface AddCandidateInput {
  /** Client-generated id, optional — same reason `AddPlantInput.plantId?` is optional: unaffected ordinary REST callers, a stable id up front for offline-optimistic sync callers. */
  readonly candidateId?: Uuid;
  readonly proposedGardenAreaMapObjectId?: Uuid;
  readonly proposedPlacementMapObjectId?: Uuid;
  readonly displayName: string;
  readonly taxonomyReferenceId?: Uuid | null;
  readonly varietyLabel?: string | null;
  readonly groupingKind: GroupingKind;
  readonly quantity?: number | null;
  readonly rationaleNote?: string | null;
  readonly priority?: CandidatePriority | null;
  readonly priceAmount?: number | null;
  readonly priceCurrency?: string | null;
  readonly purchaseSource?: string | null;
  readonly alternativeToCandidateId?: Uuid | null;
}

function normalizedPlacement(input: AddCandidateInput): CandidatePlacement {
  return {
    proposedGardenAreaMapObjectId: input.proposedGardenAreaMapObjectId ?? null,
    proposedPlacementMapObjectId: input.proposedPlacementMapObjectId ?? null,
  };
}

export class AddCandidate {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: PlantsInventoryUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(gardenId: Uuid, profileId: Uuid, input: AddCandidateInput, idempotencyKey: string) {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      201,
      async (context) => {
        const now = this.clock.now();
        const placement = normalizedPlacement(input);
        await requireCandidatePlacementReferencesGardenObjects(
          context.mapObjects,
          gardenId,
          placement,
        );

        const candidate = createCandidate(
          input.candidateId ?? generateUuidV7(),
          gardenId,
          placement,
          input.displayName,
          input.taxonomyReferenceId ?? null,
          input.varietyLabel ?? null,
          input.groupingKind,
          input.quantity,
          input.rationaleNote ?? null,
          input.priority ?? null,
          {
            priceAmount: input.priceAmount ?? null,
            priceCurrency: input.priceCurrency ?? null,
            purchaseSource: input.purchaseSource ?? null,
          },
          input.alternativeToCandidateId ?? null,
          profileId,
          now,
        );

        await context.candidates.insert(candidate);
        // No `syncChanges.record` call yet: `SyncRecordType` is a closed union
        // shared with the generated OpenAPI sync-pull contract
        // (`sync-record-pull-capability.ts`, `get-sync-changes.ts`'s
        // exhaustive switch) — adding `'plantCandidate'` to it is contract
        // work that belongs to `P11-API-01` ("contract-first... sync
        // semantics"), not this schema/domain work package. The candidate
        // row itself is fully durable now; only cross-client push/pull sync
        // is deferred.

        return candidate;
      },
    );
  }
}
