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

  /**
   * Writes the profile's new state guarded by `expectedRevision`, returning
   * `false` when a concurrent write already moved it — the same
   * report-nothing-decide-nothing contract `GardenRepository.update`
   * documents (P8-DELETE-01).
   */
  update(profile: Profile, expectedRevision: number): Promise<boolean>;

  /**
   * Profiles whose recovery window has closed and whose purge the deletion
   * sweep may now claim, oldest deadline first, bounded by `limit`
   * (P8-DELETE-01).
   */
  listDeletionDue(now: Date, limit: number): Promise<Profile[]>;
}
