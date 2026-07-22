import { describe, expect, it, vi } from 'vitest';
import type { AuditEventInput, AuditLogger } from '../../../platform/audit/audit-logger.js';
import type { VerifiedCredential } from '../../../platform/authentication/verified-credential.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { Profile } from '../domain/profile.js';
import type { IdentityProviderLinkRepository } from './identity-provider-link-repository.js';
import type { ProfileRepository } from './profile-repository.js';
import { ProvisionProfile } from './provision-profile.js';

const NOW = new Date('2026-07-21T09:00:00Z');

function fixedClock(): Clock {
  return { now: () => NOW };
}

function credential(overrides: Partial<VerifiedCredential> = {}): VerifiedCredential {
  return {
    firebaseUid: 'firebase-uid-1',
    signInProvider: 'google.com',
    providerUid: 'google-sub-1',
    authenticatedAt: NOW,
    email: 'gardener@example.com',
    emailVerified: true,
    ...overrides,
  };
}

class FakeProfileRepository implements ProfileRepository {
  readonly profiles: Profile[] = [];
  insertError: Error | null = null;

  findByFirebaseUid(firebaseUid: string): Promise<Profile | null> {
    return Promise.resolve(this.profiles.find((p) => p.firebaseUid === firebaseUid) ?? null);
  }

  findById(id: string): Promise<Profile | null> {
    return Promise.resolve(this.profiles.find((p) => p.id === id) ?? null);
  }

  insert(profile: Profile): Promise<void> {
    if (this.insertError !== null) {
      const error = this.insertError;
      this.insertError = null;
      return Promise.reject(error);
    }
    this.profiles.push(profile);
    return Promise.resolve();
  }
}

class FakeIdentityProviderLinkRepository implements IdentityProviderLinkRepository {
  readonly links: { profileId: string; provider: string }[] = [];

  link(profileId: string, provider: string): Promise<void> {
    this.links.push({ profileId, provider });
    return Promise.resolve();
  }
}

class FakeAuditLogger implements AuditLogger {
  readonly events: AuditEventInput[] = [];

  record(input: AuditEventInput): Promise<void> {
    this.events.push(input);
    return Promise.resolve();
  }
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

describe('ProvisionProfile', () => {
  it('creates a new active profile on first sign-in and audits it', async () => {
    const profiles = new FakeProfileRepository();
    const links = new FakeIdentityProviderLinkRepository();
    const audit = new FakeAuditLogger();
    const useCase = new ProvisionProfile(profiles, links, fixedClock(), audit);

    const profile = await useCase.execute(credential());

    expect(profile.firebaseUid).toBe('firebase-uid-1');
    expect(profile.accountState).toBe('active');
    expect(profile.revision).toBe(1);
    expect(profiles.profiles).toHaveLength(1);
    expect(audit.events).toEqual([
      expect.objectContaining({ eventType: 'profile.provisioned', subjectId: profile.id }),
    ]);
  });

  it('returns the existing profile on a later sign-in without inserting again', async () => {
    const profiles = new FakeProfileRepository();
    const links = new FakeIdentityProviderLinkRepository();
    const audit = new FakeAuditLogger();
    const useCase = new ProvisionProfile(profiles, links, fixedClock(), audit);

    const first = await useCase.execute(credential());
    const second = await useCase.execute(credential());

    expect(second).toEqual(first);
    expect(profiles.profiles).toHaveLength(1);
    expect(audit.events).toHaveLength(1);
  });

  it('refreshes the provider link on every sign-in, not only the first', async () => {
    const profiles = new FakeProfileRepository();
    const links = new FakeIdentityProviderLinkRepository();
    const useCase = new ProvisionProfile(profiles, links, fixedClock(), new FakeAuditLogger());

    await useCase.execute(credential({ signInProvider: 'google.com' }));
    await useCase.execute(credential({ signInProvider: 'apple.com' }));

    expect(links.links.map((l) => l.provider)).toEqual(['google.com', 'apple.com']);
  });

  it('recovers from a concurrent duplicate insert by returning the winner’s profile', async () => {
    const profiles = new FakeProfileRepository();
    const links = new FakeIdentityProviderLinkRepository();
    const audit = new FakeAuditLogger();
    const useCase = new ProvisionProfile(profiles, links, fixedClock(), audit);

    // Simulates another concurrent request committing between this
    // request's own findByFirebaseUid (finding nothing) and its insert.
    const raceWinner: Profile = {
      id: 'raced-profile-id',
      firebaseUid: 'firebase-uid-1',
      accountState: 'active',
      locale: 'en',
      timeZone: 'UTC',
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const originalFind = profiles.findByFirebaseUid.bind(profiles);
    const findSpy = vi
      .spyOn(profiles, 'findByFirebaseUid')
      .mockImplementationOnce(() => Promise.resolve(null))
      .mockImplementationOnce(() => {
        profiles.profiles.push(raceWinner);
        return originalFind('firebase-uid-1');
      });
    profiles.insertError = uniqueViolation();

    const profile = await useCase.execute(credential());

    expect(profile).toEqual(raceWinner);
    expect(audit.events).toHaveLength(0);
    findSpy.mockRestore();
  });
});
