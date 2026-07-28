import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import {
  IdentifyPlantSpecies,
  type PlantIdentificationModelIdentity,
  type PlantSpeciesIdentificationAdapterOutcome,
  type PlantSpeciesIdentificationProviderAdapter,
  type PlantSpeciesIdentificationRequest,
  type ProviderQuotaConsumeResult,
  type ProviderQuotaLimits,
  type ProviderQuotaRepository,
} from '../../integrations/public.js';
import { registerMediaRecord } from '../../media/public.js';
import type { TaxonomyReference } from '../domain/taxonomy-reference.js';
import { AddPlantFromPhoto } from './add-plant-from-photo.js';
import {
  authorizationGranting,
  createPlantsInventoryFakes,
  FakePlantsInventoryUnitOfWork,
  fixedClock,
} from './plants-inventory-test-doubles.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const MEDIA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const NOW = new Date('2026-07-21T09:00:00Z');
const PROVIDER_KEY = 'vertex-ai-plant-species';

/** Matches `SearchTaxonomyReferences.test.ts`'s own local-fake convention — no shared double exists for this narrow repository. */
class FakeTaxonomyReferenceRepository implements TaxonomyReferenceRepository {
  constructor(private readonly catalog: readonly TaxonomyReference[] = []) {}

  findById(id: string): Promise<TaxonomyReference | null> {
    return Promise.resolve(this.catalog.find((entry) => entry.id === id) ?? null);
  }

  search(query: string | null): Promise<TaxonomyReference[]> {
    if (query === null) {
      return Promise.resolve([...this.catalog]);
    }
    return Promise.resolve(
      this.catalog.filter((entry) => entry.commonName?.toLowerCase() === query.toLowerCase()),
    );
  }
}

/** Always succeeds, unlimited — these tests exercise the identification outcome, not quota accounting. */
class AlwaysAllowProviderQuotaRepository implements ProviderQuotaRepository {
  consumeCall(
    _providerKey: string,
    _limits: ProviderQuotaLimits,
    _now: Date,
  ): Promise<ProviderQuotaConsumeResult> {
    return Promise.resolve({ consumed: true });
  }
}

/** A scriptable fake, local to this file per this codebase's cross-module-boundary convention (test doubles stay module-internal). */
class FakePlantSpeciesIdentificationProviderAdapter implements PlantSpeciesIdentificationProviderAdapter {
  readonly identity: PlantIdentificationModelIdentity = {
    model: 'fake-plant-species-model',
    promptTemplateVersion: 1,
  };

  constructor(private readonly outcome: PlantSpeciesIdentificationAdapterOutcome) {}

  identifySpecies(
    _request: PlantSpeciesIdentificationRequest,
    _signal: AbortSignal,
  ): Promise<PlantSpeciesIdentificationAdapterOutcome> {
    return Promise.resolve(this.outcome);
  }
}

function identifyPlantSpeciesWith(
  adapter: PlantSpeciesIdentificationProviderAdapter | null,
): IdentifyPlantSpecies {
  return new IdentifyPlantSpecies(
    adapter,
    {
      providerKey: PROVIDER_KEY,
      callTimeoutMs: 1_000,
      quotaLimits: { maxCallsPerHour: null, maxCallsPerDay: null },
    },
    new AlwaysAllowProviderQuotaRepository(),
    fixedClock(NOW),
    pino({ level: 'silent' }),
  );
}

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithMedia() {
  const fakes = createPlantsInventoryFakes();
  fakes.media.records.set(MEDIA_ID, {
    ...registerMediaRecord(
      MEDIA_ID,
      GARDEN_ID,
      PROFILE_ID,
      'garden_photo',
      'photo.jpg',
      'image/jpeg',
      123_456,
      null,
      null,
      null,
      null,
      NOW,
    ),
    // Attachment now requires an `available` record (P6-RET-01's
    // attach-versus-delete guard).
    uploadState: 'available' as const,
  });
  return fakes;
}

describe('AddPlantFromPhoto', () => {
  it('creates a plant, one plant_photo, and one plant_identification row, with taxonomyReferenceId staying null', async () => {
    const fakes = fakesWithMedia();
    const addPlantFromPhoto = new AddPlantFromPhoto(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
      identifyPlantSpeciesWith(null),
      new FakeTaxonomyReferenceRepository(),
      pino({ level: 'silent' }),
    );

    const result = await addPlantFromPhoto.execute(
      GARDEN_ID,
      PROFILE_ID,
      { photoMediaId: MEDIA_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result.taxonomyReferenceId).toBeNull();
    expect(result.groupingKind).toBe('individual');
    expect(fakes.plants.plants.size).toBe(1);
    expect(fakes.plantPhotos.photos.size).toBe(1);
    expect(fakes.plantIdentifications.identifications.size).toBe(1);

    const photo = [...fakes.plantPhotos.photos.values()][0];
    expect(photo?.plantId).toBe(result.id);
    expect(photo?.mediaId).toBe(MEDIA_ID);
    expect(photo?.isPrimary).toBe(true);

    const identification = [...fakes.plantIdentifications.identifications.values()][0];
    expect(identification?.plantId).toBe(result.id);
    expect(identification?.plantPhotoId).toBe(photo?.id);
    // The kill-switch is off (the disabled adapter passed above) — the same
    // honest "no suggestion" answer the historical stub always gave.
    expect(identification?.suggestedTaxonomyId).toBeNull();
    expect(identification?.confidenceScore).toBe(0);

    expect(fakes.revisionJournal.entries).toEqual([
      {
        plantId: result.id,
        revision: 1,
        commandType: 'addPlantFromPhoto',
        lifecycleStage: 'planned',
        status: 'active',
        gardenAreaMapObjectId: null,
        placementMapObjectId: null,
        taxonomyReferenceId: null,
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('resolves a confident candidate against the taxonomy catalog when the provider is enabled', async () => {
    const fakes = fakesWithMedia();
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter({
      kind: 'candidate',
      candidate: {
        commonName: 'Tomato',
        scientificNameGuess: 'Solanum lycopersicum',
        confidenceScore: 0.9,
      },
    });
    const identifyPlantSpecies = identifyPlantSpeciesWith(adapter);
    const tomato: TaxonomyReference = {
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a1a',
      scientificName: 'Solanum lycopersicum',
      commonName: 'Tomato',
      varietyName: null,
      family: 'Solanaceae',
      genus: 'Solanum',
      source: 'system_catalog',
      createdByProfileId: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const addPlantFromPhoto = new AddPlantFromPhoto(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
      identifyPlantSpecies,
      new FakeTaxonomyReferenceRepository([tomato]),
      pino({ level: 'silent' }),
    );

    const result = await addPlantFromPhoto.execute(
      GARDEN_ID,
      PROFILE_ID,
      { photoMediaId: MEDIA_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a1b',
    );

    // The suggestion feeds only the plant_identification proposal row —
    // never the plant's own displayName/taxonomyReferenceId directly,
    // identification's own "never auto-confirms" invariant.
    expect(result.taxonomyReferenceId).toBeNull();
    const identification = [...fakes.plantIdentifications.identifications.values()][0];
    expect(identification?.suggestedTaxonomyId).toBe(tomato.id);
    expect(identification?.confidenceScore).toBe(0.9);
  });

  it('preserves the AI raw name guess when a confident candidate has no catalog match', async () => {
    const fakes = fakesWithMedia();
    const adapter = new FakePlantSpeciesIdentificationProviderAdapter({
      kind: 'candidate',
      candidate: {
        commonName: 'Green ash',
        scientificNameGuess: 'Fraxinus pennsylvanica',
        confidenceScore: 0.88,
      },
    });
    const identifyPlantSpecies = identifyPlantSpeciesWith(adapter);
    const addPlantFromPhoto = new AddPlantFromPhoto(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
      identifyPlantSpecies,
      new FakeTaxonomyReferenceRepository(),
      pino({ level: 'silent' }),
    );

    await addPlantFromPhoto.execute(
      GARDEN_ID,
      PROFILE_ID,
      { photoMediaId: MEDIA_ID },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a1c',
    );

    const identification = [...fakes.plantIdentifications.identifications.values()][0];
    expect(identification?.suggestedTaxonomyId).toBeNull();
    expect(identification?.suggestedCommonName).toBe('Green ash');
    expect(identification?.suggestedScientificName).toBe('Fraxinus pennsylvanica');
    expect(identification?.confidenceScore).toBe(0.88);
  });

  it('rejects a photoMediaId that MediaRepository.get does not return', async () => {
    const fakes = createPlantsInventoryFakes();
    const addPlantFromPhoto = new AddPlantFromPhoto(
      fakes.idempotency,
      new FakePlantsInventoryUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
      identifyPlantSpeciesWith(null),
      new FakeTaxonomyReferenceRepository(),
      pino({ level: 'silent' }),
    );

    await expect(
      addPlantFromPhoto.execute(
        GARDEN_ID,
        PROFILE_ID,
        { photoMediaId: MEDIA_ID },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.plants.plants.size).toBe(0);
    expect(fakes.plantPhotos.photos.size).toBe(0);
    expect(fakes.plantIdentifications.identifications.size).toBe(0);
  });
});
