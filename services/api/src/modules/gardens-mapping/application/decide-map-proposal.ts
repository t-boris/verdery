import { MapErrorCode } from '@verdery/api-contracts';
import type { DecideProposalPayload } from '@verdery/geometry-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { MapCommandResultResource } from './map-object-view.js';

/**
 * `decideProposal` exists in `packages/geometry-contracts`'s command model
 * for forward compatibility, but Phase 3 generates no proposals to decide
 * on: the migration's own comment on this schema says so explicitly
 * ("Deliberately absent: a `proposal` table... assisted capture arrives with
 * Phase 10"). Every call therefore fails `notFound`, honestly reflecting
 * that nothing exists yet — not a stub that pretends to succeed.
 *
 * Still authorizes `editGardenContent` first, so an unauthorized caller sees
 * the same concealment behavior every other map command gives them, rather
 * than learning anything about proposal state from this command's response
 * before their own permission is checked.
 */
export class DecideMapProposal {
  constructor(private readonly authorization: GardenAuthorization) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    _payload: DecideProposalPayload,
  ): Promise<MapCommandResultResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    throw new NotFoundError(MapErrorCode.NotFound, 'No proposal exists to decide.');
  }
}
