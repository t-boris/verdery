import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantProfileVersion } from '../domain/plant-profile-version.js';

export interface PlantProfileVersionRepository {
  insert(version: PlantProfileVersion): Promise<void>;
  /** The most recently assembled version for a taxon, or `null` if none has ever been built. */
  findLatest(taxonomyReferenceId: Uuid): Promise<PlantProfileVersion | null>;
}
