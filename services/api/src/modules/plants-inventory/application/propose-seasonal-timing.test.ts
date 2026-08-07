import { describe, expect, it } from 'vitest';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  ProviderQuotaConsumeResult,
  ProviderQuotaRepository,
  SeasonalTimingProposalOutcome,
  SeasonalTimingProposalProvider,
} from '../../integrations/public.js';
import { ProposeSeasonalTiming } from './propose-seasonal-timing.js';
import type {
  SeasonalProposalCandidate,
  SeasonalProposalCandidateSource,
} from './propose-seasonal-timing.js';
import type {
  TaxonomySeasonalFactProposalInput,
  TaxonomySeasonalFactRepository,
} from './taxonomy-seasonal-fact-repository.js';

const TAXON_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e02' as Uuid;
const NOW = new Date('2026-08-07T12:00:00Z');
const CONFIGURATION = {
  providerKey: 'vertex-ai-seasonal-timing',
  callTimeoutMs: 5_000,
  quotaLimits: { maxCallsPerHour: 100, maxCallsPerDay: 500 },
};

function candidate(): SeasonalProposalCandidate {
  return {
    taxonomyReferenceId: TAXON_ID,
    scientificName: 'Solanum lycopersicum',
    commonName: 'Tomato',
    family: 'Solanaceae',
    hemisphere: 'northern',
  };
}

class FakeCandidates implements SeasonalProposalCandidateSource {
  constructor(private readonly items: SeasonalProposalCandidate[] = [candidate()]) {}
  listCandidates(limit: number): Promise<readonly SeasonalProposalCandidate[]> {
    return Promise.resolve(this.items.slice(0, limit));
  }
}

class FakeFacts implements TaxonomySeasonalFactRepository {
  readonly inserted: TaxonomySeasonalFactProposalInput[] = [];
  constructor(private readonly acceptInsert = true) {}
  findReviewedForTaxonomyAndHemisphere(): Promise<null> {
    return Promise.resolve(null);
  }
  listAwaitingReview(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }
  approve(): Promise<boolean> {
    return Promise.resolve(false);
  }
  insertProposal(input: TaxonomySeasonalFactProposalInput): Promise<boolean> {
    this.inserted.push(input);
    return Promise.resolve(this.acceptInsert);
  }
}

class FakeQuotas implements ProviderQuotaRepository {
  calls = 0;
  constructor(private readonly allow = Number.POSITIVE_INFINITY) {}
  consumeCall(): Promise<ProviderQuotaConsumeResult> {
    this.calls += 1;
    return Promise.resolve(
      this.calls <= this.allow
        ? { consumed: true }
        : { consumed: false, exhaustedWindow: 'hour' as const },
    );
  }
}

function providerReturning(
  outcome: SeasonalTimingProposalOutcome,
): SeasonalTimingProposalProvider & { calls: number } {
  const provider = {
    calls: 0,
    proposeSeasonalTiming: () => {
      provider.calls += 1;
      return Promise.resolve(outcome);
    },
  };
  return provider;
}

const DRAFT = {
  sowIndoorsStartMonth: 2,
  sowIndoorsEndMonth: 3,
  sowOutdoorsStartMonth: null,
  sowOutdoorsEndMonth: null,
  transplantStartMonth: 5,
  transplantEndMonth: 6,
  harvestStartMonth: 7,
  harvestEndMonth: 10,
  daysToMaturityMin: 60,
  daysToMaturityMax: 90,
  successionIntervalDays: null,
  rotationRestSeasons: 3,
};

const clock = { now: () => NOW };

function build(options: {
  readonly provider?: SeasonalTimingProposalProvider | null;
  readonly facts?: FakeFacts;
  readonly quotas?: FakeQuotas;
  readonly candidates?: SeasonalProposalCandidateSource;
}) {
  return new ProposeSeasonalTiming(
    options.provider === undefined
      ? providerReturning({ kind: 'drafted', draft: DRAFT })
      : options.provider,
    options.candidates ?? new FakeCandidates(),
    options.facts ?? new FakeFacts(),
    options.quotas ?? new FakeQuotas(),
    CONFIGURATION,
    clock,
  );
}

describe('ProposeSeasonalTiming', () => {
  it('writes the draft as an INERT proposal — never as reviewed, never with a borrowed citation', async () => {
    const facts = new FakeFacts();

    const result = await build({ facts }).execute();

    expect(result.proposed).toBe(1);
    const written = facts.inserted[0];
    expect(written?.taxonomyReferenceId).toBe(TAXON_ID);
    expect(written?.sowIndoorsStartMonth).toBe(2);
    // The repository fixes `ai_proposed_reviewed` and
    // `awaiting_horticultural_review`; the use case cannot supply either,
    // which is what makes the provenance unfakeable from here.
    expect(Object.keys(written ?? {})).not.toContain('reviewStatus');
    expect(Object.keys(written ?? {})).not.toContain('sourceCitation');
  });

  it('does not exist at all when the capability is switched off — zero provider calls', async () => {
    const facts = new FakeFacts();
    const quotas = new FakeQuotas();

    const result = await build({ provider: null, facts, quotas }).execute();

    expect(result).toEqual({
      considered: 0,
      proposed: 0,
      declined: 0,
      alreadyPresent: 0,
      unavailable: 0,
      stoppedOnQuotaExhaustion: false,
    });
    expect(quotas.calls).toBe(0);
    expect(facts.inserted).toHaveLength(0);
  });

  it('counts a decline and writes nothing — an all-null proposal is not reviewable content', async () => {
    const facts = new FakeFacts();

    const result = await build({
      provider: providerReturning({ kind: 'declined', reason: 'noTimingClaimed' }),
      facts,
    }).execute();

    expect(result.declined).toBe(1);
    expect(result.proposed).toBe(0);
    expect(facts.inserted).toHaveLength(0);
  });

  it('stops the batch on quota exhaustion instead of grinding through refusals', async () => {
    const provider = providerReturning({ kind: 'drafted', draft: DRAFT });
    const candidates = new FakeCandidates([candidate(), candidate(), candidate()]);

    const result = await build({
      provider,
      candidates,
      quotas: new FakeQuotas(1),
    }).execute();

    expect(result.stoppedOnQuotaExhaustion).toBe(true);
    expect(result.considered).toBe(1);
    // Every later candidate would spend and fail against the same
    // exhausted budget, so none of them is attempted.
    expect(provider.calls).toBe(1);
  });

  it('consumes quota BEFORE calling, so a crashed call cannot leave the budget unspent', async () => {
    const quotas = new FakeQuotas();
    const provider = providerReturning({ kind: 'unavailable', reason: 'transport' });

    const result = await build({ provider, quotas }).execute();

    expect(quotas.calls).toBe(1);
    expect(result.unavailable).toBe(1);
  });

  it('counts an existing row rather than overwriting it, so review work is never disturbed', async () => {
    const facts = new FakeFacts(false);

    const result = await build({ facts }).execute();

    expect(result.alreadyPresent).toBe(1);
    expect(result.proposed).toBe(0);
  });
});
