import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Profile } from '../domain/profile.js';

export interface ProfileRepository {
  findByFirebaseUid(firebaseUid: string): Promise<Profile | null>;
  findById(id: Uuid): Promise<Profile | null>;

  /**
   * Inserts a new profile. Throws on a `firebase_uid` conflict rather than
   * silently upserting: the caller (`ProvisionProfile`) decides how to react
   * to a race, and a silent upsert would hide a real bug if it ever happened
   * for any other reason.
   */
  insert(profile: Profile): Promise<void>;
}
