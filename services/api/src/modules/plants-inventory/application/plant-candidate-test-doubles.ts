/**
 * Candidate-specific test doubles, split out of
 * `plants-inventory-test-doubles.ts` for the 600-line reason that file's own
 * header already explains for its command-fake collection generally — P11
 * candidate commands pushed it over the limit. Same shape, same fidelity
 * (`FakePlantCandidateRepository.list` is the same index-into-sorted-array
 * cursor `FakePlantRepository.search` uses), just its own file.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidateConversion } from '../domain/candidate-conversion.js';
import type { PlantCandidate } from '../domain/plant-candidate.js';
import type { CandidateConversionRepository } from './candidate-conversion-repository.js';
import type {
  CandidateListFilters,
  CandidateListPage,
  PlantCandidateRepository,
} from './plant-candidate-repository.js';

/** A minimal, valid `PlantCandidate` for tests that need one already stored, with any field overridable — mirrors `buildPlant`. */
export function buildCandidate(
  overrides: Partial<PlantCandidate> & { id: Uuid; gardenId: Uuid },
): PlantCandidate {
  return {
    proposedGardenAreaMapObjectId: null,
    proposedPlacementMapObjectId: null,
    displayName: 'Fig tree',
    taxonomyReferenceId: null,
    varietyLabel: null,
    groupingKind: 'individual',
    quantity: null,
    status: 'active',
    rationaleNote: null,
    priority: null,
    priceAmount: null,
    priceCurrency: null,
    purchaseSource: null,
    alternativeToCandidateId: null,
    revision: 1,
    createdByProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a99',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

export class FakePlantCandidateRepository implements PlantCandidateRepository {
  readonly candidates = new Map<Uuid, PlantCandidate>();

  findById(candidateId: Uuid): Promise<PlantCandidate | null> {
    return Promise.resolve(this.candidates.get(candidateId) ?? null);
  }

  insert(candidate: PlantCandidate): Promise<void> {
    this.candidates.set(candidate.id, candidate);
    return Promise.resolve();
  }

  update(candidate: PlantCandidate, expectedRevision: number): Promise<boolean> {
    const existing = this.candidates.get(candidate.id);
    if (existing === undefined || existing.revision !== expectedRevision) {
      return Promise.resolve(false);
    }
    this.candidates.set(candidate.id, candidate);
    return Promise.resolve(true);
  }

  /**
   * Not a real trigram implementation — `query` here is a plain
   * case-insensitive substring test against `displayName`, sufficient for
   * `ListCandidates`'s own unit tests, the same `FakePlantRepository.search`
   * precedent. A simple index-into-the-sorted-array cursor, the same
   * fidelity that fake uses — real keyset-cursor and trigram-ranking
   * behavior is exercised only against real PostgreSQL.
   */
  list(
    gardenId: Uuid,
    filters: CandidateListFilters,
    cursor: string | null,
    limit: number,
  ): Promise<CandidateListPage> {
    const matches = [...this.candidates.values()]
      .filter((candidate) => candidate.gardenId === gardenId)
      .filter(
        (candidate) =>
          filters.query === null ||
          candidate.displayName.toLowerCase().includes(filters.query.toLowerCase()),
      )
      .filter((candidate) => filters.status === null || filters.status.includes(candidate.status))
      .filter(
        (candidate) =>
          filters.priority === null ||
          (candidate.priority !== null && filters.priority.includes(candidate.priority)),
      )
      .filter(
        (candidate) =>
          filters.identified === null ||
          filters.identified === (candidate.taxonomyReferenceId !== null),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));

    const start = cursor === null ? 0 : Number(cursor);
    const pageItems = matches.slice(start, start + limit);
    const hasMore = start + limit < matches.length;

    return Promise.resolve({
      items: pageItems,
      nextCursor: hasMore ? String(start + limit) : null,
    });
  }
}

export class FakeCandidateConversionRepository implements CandidateConversionRepository {
  readonly conversions = new Map<Uuid, CandidateConversion>();

  /** Throws a unique-violation-shaped error on a second insert for the same candidate — mirrors `candidate_conversion_candidate_id_key`, so `ConvertCandidate`'s own race-handling branch is unit-testable without a real database. */
  insert(conversion: CandidateConversion): Promise<void> {
    if (this.conversions.has(conversion.candidateId)) {
      const error = new Error('duplicate key value violates unique constraint');
      Object.assign(error, {
        code: '23505',
        constraint: 'candidate_conversion_candidate_id_key',
      });
      return Promise.reject(error);
    }
    this.conversions.set(conversion.candidateId, conversion);
    return Promise.resolve();
  }

  findByCandidateId(candidateId: Uuid): Promise<CandidateConversion | null> {
    return Promise.resolve(this.conversions.get(candidateId) ?? null);
  }
}
