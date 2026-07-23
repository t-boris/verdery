/**
 * Routes one `recordType: 'observation'` sync operation to
 * observations-history's two command classes.
 *
 * `fetchCurrentRecord` is always `null` here: observations carry no
 * revision at all (immutable, append-only — see `Observation`'s own
 * OpenAPI description, "no revision, no update path"), so `StaleRevisionError`
 * can never occur for this family and `conflict` has no producer here. Every
 * `recordRevisions` entry uses the constant `1`, mirroring
 * `RecordObservation`'s and `CorrectObservation`'s own `platform.sync_change`
 * writes, which already treat `1` as this aggregate's genuinely constant
 * revision, not a placeholder.
 */

import type { SyncObservationOperationPayload, SyncRecordReference } from '@verdery/api-contracts';
import type { CorrectObservation, RecordObservation } from '../../observations-history/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { executeAndMapOutcome } from './execute-and-map-outcome.js';
import type { SyncOperationOutcome } from './sync-operation-outcome.js';

export interface ObservationOperationRouterDependencies {
  readonly recordObservation: RecordObservation;
  readonly correctObservation: CorrectObservation;
}

function toRecordRevisions(observationId: Uuid): SyncRecordReference[] {
  return [{ recordId: observationId, recordType: 'observation', revision: 1 }];
}

export async function routeObservationOperation(
  deps: ObservationOperationRouterDependencies,
  profileId: Uuid,
  operationId: Uuid,
  payload: SyncObservationOperationPayload,
): Promise<SyncOperationOutcome> {
  const { gardenId, command } = payload;

  switch (command.commandType) {
    case 'observations.record':
      return executeAndMapOutcome(async () => {
        const observation = await deps.recordObservation.execute(
          gardenId,
          profileId,
          {
            plantId: command.request.plantId ?? null,
            gardenObjectId: command.request.gardenObjectId ?? null,
            noteText: command.request.noteText ?? null,
            conditionSummary: command.request.conditionSummary ?? null,
            observedAt:
              command.request.observedAt === undefined || command.request.observedAt === null
                ? null
                : new Date(command.request.observedAt),
            photoMediaIds: command.request.photoMediaIds ?? [],
            observationId: command.observationId,
          },
          operationId,
        );
        return toRecordRevisions(observation.id);
      }, null);

    case 'observations.correct':
      return executeAndMapOutcome(async () => {
        const observation = await deps.correctObservation.execute(
          command.correctedObservationId,
          profileId,
          {
            correctionKind: command.request.correctionKind,
            noteText: command.request.noteText ?? null,
            conditionSummary: command.request.conditionSummary ?? null,
            photoMediaIds: command.request.photoMediaIds ?? [],
            observationId: command.observationId,
          },
          operationId,
        );
        return toRecordRevisions(observation.id);
      }, null);
  }
}
