import { MapErrorCode } from '@verdery/api-contracts';
import type { GeoreferenceMethod } from '@verdery/api-contracts';
import type { Position } from '@verdery/geometry-contracts';
import { StaleRevisionError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  DEFAULT_SCALE_CORRECTION,
  nextGeoreferenceRevision,
  provenanceForGeoreferenceMethod,
} from '../domain/georeference.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGeoreferenceResource, type GeoreferenceResource } from './get-garden-map.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'map.setGeoreference';

export interface SetGardenGeoreferenceInput {
  readonly localAnchor: Position;
  readonly geographicAnchor: Position;
  readonly rotationDegrees: number;
  readonly scaleCorrection?: number;
  readonly accuracyMetres?: number;
  readonly displayAddress?: string;
  readonly method: GeoreferenceMethod;
}

/**
 * `PUT /gardens/{gardenId}/georeference` — where the garden sits on the
 * Earth, and how its local axes are turned against true north (P12-GEO-01).
 *
 * This is the input every geographic capability already reads and, until
 * now, could never find: `gardens_mapping.georeference` has existed since
 * the Phase 3 map baseline and is joined by weather refresh, hemisphere, and
 * the seasonal plan, but nothing outside tests could write a row. A deployed
 * garden therefore had no weather and no season, not because those features
 * were unbuilt, but because their one input was unreachable.
 *
 * `manageGarden`, not `editGardenContent`: the capability matrix already
 * decided this (`docs/development/garden-capability-matrix.md`, row A17 —
 * "Configure garden-level settings other than the name", owner only). It is
 * the conservative reading too, since a wrong anchor changes the weather and
 * the season every collaborator sees.
 *
 * Concurrency mirrors every other revision-guarded command, with one
 * addition this resource needs: the record may not exist yet. `If-Match`
 * absent asserts exactly that, and asserting it wrongly is a conflict rather
 * than an overwrite — two people georeferencing the same garden from
 * different places must not silently take turns clobbering each other.
 */
export class SetGardenGeoreference {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: SetGardenGeoreferenceInput,
    expectedRevision: number | null,
    idempotencyKey: string,
  ): Promise<GeoreferenceResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'manageGarden');

    const command = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, input, expectedRevision }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      command,
      200,
      async (context) => {
        const now = this.clock.now();

        // `findOrCreate`, because placing a garden on the Earth may well be the
        // first thing anyone does with its map — a coordinate space is created
        // lazily on first map interaction, and this is one.
        const space = await context.coordinateSpaces.findOrCreateForGarden(gardenId, now);

        const current = await context.georeferences.findCurrentForGarden(gardenId);

        assertRevisionMatches(current?.revision ?? null, expectedRevision);

        const written = await context.georeferences.supersedeCurrent(
          {
            gardenId,
            coordinateSpaceId: space.id,
            localAnchor: input.localAnchor,
            geographicAnchor: input.geographicAnchor,
            rotationDegrees: input.rotationDegrees,
            scaleCorrection: input.scaleCorrection ?? DEFAULT_SCALE_CORRECTION,
            accuracyMetres: input.accuracyMetres ?? null,
            displayAddress: input.displayAddress ?? null,
            provenance: provenanceForGeoreferenceMethod(input.method),
            method: input.method,
            revision: nextGeoreferenceRevision(current?.revision ?? null),
            createdByProfileId: profileId,
          },
          now,
        );

        // Audited: this changes what location-derived facts a whole garden
        // gets, and it is a garden-level setting, which section 6 of
        // security-and-privacy.md puts inside the audit boundary. The exact
        // coordinate stays OUT of the record — it is the sensitive part, the
        // audit answers "who moved this garden and when", and the georeference
        // history itself answers "to where".
        await context.auditLogger.record({
          eventType: 'garden.georeferenced',
          subjectType: 'garden',
          subjectId: gardenId,
          actorProfileId: profileId,
          actorType: 'user',
        });

        // No `syncChanges` row, deliberately. The offline clients have no local
        // georeference table to project one into: both read it inside the map
        // document, which they fetch when they open a map. A change-log entry
        // no client can apply would be a protocol claim this system does not
        // honour. When a client grows that table, the record type and its
        // projection arrive together.
        return toGeoreferenceResource(written);
      },
    );
  }
}

/**
 * The precondition, in both directions.
 *
 * `If-Match` present asserts "the current revision is exactly this one";
 * absent asserts "there is no current record". Each can be wrong, and a
 * wrong one is refused rather than resolved: an omitted header against an
 * existing record is the case that would otherwise silently discard someone
 * else's georeference.
 *
 * The current revision travels in `details` the same way
 * `apply-revision-guarded-update.ts` sends it, so a client can retry without
 * a second read.
 */
function assertRevisionMatches(currentRevision: number | null, expectedRevision: number | null) {
  if (currentRevision === expectedRevision) {
    return;
  }

  const details =
    currentRevision === null
      ? []
      : [{ code: 'garden.georeference.revision', parameters: { currentRevision } }];

  throw new StaleRevisionError(
    MapErrorCode.StaleRevision,
    currentRevision === null
      ? 'This garden has never been georeferenced; omit If-Match to create the first record.'
      : expectedRevision === null
        ? 'This garden is already georeferenced; pass its current revision in If-Match.'
        : 'The georeference changed before this command was applied.',
    { details },
  );
}
