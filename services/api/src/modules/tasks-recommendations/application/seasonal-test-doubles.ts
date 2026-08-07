/**
 * The `plants-inventory` read doubles the recommendation engine consults for
 * facts it does not own — taxon identity, per-garden seasonal timing, and bed
 * occupancy history. Split out of `recommendation-test-doubles.ts` for the
 * 600-line budget, the same way `plant-content-test-doubles.ts` was split out
 * of its own sibling. Not a `*.test.ts` file; vitest never runs it as a suite.
 *
 * `recommendation-test-doubles.ts` re-exports everything here, so every
 * existing import of these doubles keeps working unchanged.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  BedOccupancyHistoryReader,
  BedOccupancyPeriod,
  GardenSeasonalFactAcceptanceInput,
  Hemisphere,
  TaxonomyReference,
  TaxonomyReferenceRepository,
  TaxonomySeasonalFact,
  TaxonomySeasonalFactRepository,
  TaxonomySeasonalFactReviewItem,
} from '../../plants-inventory/public.js';

/** `findById` serves `gather-seasonal-facts.ts`'s own two reads (a taxon's own family, and a departed bed occupant's family); `search` throws since no unit test in this suite drives it. */
export class FakeTaxonomyReferenceRepository implements TaxonomyReferenceRepository {
  constructor(private readonly references: Map<Uuid, TaxonomyReference> = new Map()) {}

  findById(id: Uuid): Promise<TaxonomyReference | null> {
    return Promise.resolve(this.references.get(id) ?? null);
  }

  search(): Promise<TaxonomyReference[]> {
    throw new Error('not used by this test');
  }

  searchAcrossNames(): ReturnType<TaxonomyReferenceRepository['searchAcrossNames']> {
    throw new Error('not used by this test');
  }

  resolveProviderSuggestion(): ReturnType<
    TaxonomyReferenceRepository['resolveProviderSuggestion']
  > {
    throw new Error('not used by this test');
  }
}

/**
 * Keyed by `${taxonomyReferenceId}:${hemisphere}`, mirroring the real
 * repository's own unique key.
 *
 * Re-applies the SAME acceptance gate the real Kysely repository's inner
 * join enforces: a seeded fact NO GARDEN has accepted is honestly invisible
 * here too, and a fact accepted by one garden is invisible to another. A
 * fake that returned unaccepted rows would let a rule suite pass while the
 * deployed rule stayed silent, which is the exact failure this gate exists
 * to make impossible.
 *
 * Seed acceptances with `acceptFor`, which is the fake's stand-in for a
 * garden owner having pressed accept.
 */
export class FakeTaxonomySeasonalFactRepository implements TaxonomySeasonalFactRepository {
  /** `${gardenId}:${factId}` for every acceptance recorded. */
  private readonly acceptances = new Set<string>();

  constructor(private readonly facts: Map<string, TaxonomySeasonalFact> = new Map()) {}

  /** Test-only seam: records that this garden accepted this fact, as `AcceptGardenSeasonalFact` would. */
  acceptFor(gardenId: Uuid, factId: Uuid): void {
    this.acceptances.add(`${gardenId}:${factId}`);
  }

  /**
   * Accepts every seeded fact for one garden — for suites whose subject is
   * something else (the seasonal plan's own arithmetic, a rule's decision)
   * and which would otherwise pass for the wrong reason, every fact reading
   * as absent. Suites about the gate ITSELF accept individually.
   */
  acceptAllFor(gardenId: Uuid): void {
    for (const fact of this.facts.values()) {
      this.acceptFor(gardenId, fact.id);
    }
  }

  findAcceptedForGarden(
    gardenId: Uuid,
    taxonomyReferenceId: Uuid,
    hemisphere: Hemisphere,
  ): Promise<TaxonomySeasonalFact | null> {
    const fact = this.facts.get(`${taxonomyReferenceId}:${hemisphere}`);
    if (fact === undefined || !this.acceptances.has(`${gardenId}:${fact.id}`)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(fact);
  }

  listAwaitingAcceptanceForGarden(
    gardenId: Uuid,
    hemisphere: Hemisphere,
    limit: number,
  ): Promise<readonly TaxonomySeasonalFactReviewItem[]> {
    const items = [...this.facts.values()]
      .filter(
        (fact) => fact.hemisphere === hemisphere && !this.acceptances.has(`${gardenId}:${fact.id}`),
      )
      .slice(0, limit)
      .map((fact) => ({
        fact,
        scientificName: `taxon-${fact.taxonomyReferenceId}`,
        commonName: null,
      }));
    return Promise.resolve(items);
  }

  acceptForGarden(input: GardenSeasonalFactAcceptanceInput): Promise<boolean> {
    const fact = [...this.facts.values()].find(
      (candidate) => candidate.id === input.taxonomySeasonalFactId,
    );
    // Mirrors the real SQL's hemisphere predicate: an id alone is not
    // enough, the fact must belong to this garden's half of the world.
    if (fact === undefined || fact.hemisphere !== input.hemisphere) {
      return Promise.resolve(false);
    }
    this.acceptFor(input.gardenId, input.taxonomySeasonalFactId);
    return Promise.resolve(true);
  }

  insertProposal(): Promise<boolean> {
    throw new Error('not used by this suite');
  }
}

/**
 * In-memory `BedOccupancyHistoryReader`, keyed by `bedMapObjectId` —
 * `BedOccupancyPeriod` itself carries no bed id (the real port's own return
 * shape: the bed was the query's input, not part of the answer), so the
 * fake's OWN seed map supplies the keying the real SQL's `WHERE
 * garden_area_map_object_id = $bed` clause performs. `findForBed` then
 * re-applies the real reconstruction query's own `[intervalStart,
 * intervalEnd]` overlap test over that bed's seeded periods.
 */
export class FakeBedOccupancyHistoryReader implements BedOccupancyHistoryReader {
  constructor(
    private readonly periodsByBed: Map<Uuid, readonly BedOccupancyPeriod[]> = new Map(),
  ) {}

  findForBed(
    bedMapObjectId: Uuid,
    intervalStart: Date,
    intervalEnd: Date,
  ): Promise<readonly BedOccupancyPeriod[]> {
    const periods = this.periodsByBed.get(bedMapObjectId) ?? [];
    const matching = periods.filter(
      (period) =>
        period.occupiedFrom.getTime() <= intervalEnd.getTime() &&
        (period.occupiedUntil === null ||
          period.occupiedUntil.getTime() >= intervalStart.getTime()),
    );
    return Promise.resolve(matching);
  }
}
