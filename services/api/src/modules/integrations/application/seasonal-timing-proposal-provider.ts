/**
 * Provider-neutral port for DRAFTING seasonal timing — ADR-0013's second
 * permitted lane, "proposal into a human review queue".
 *
 * WHAT THIS IS AND IS NOT. ADR-0013 permits a model to "propose care
 * attributes for a plant with no licensed source, as a bulk offline
 * authoring pass", and is emphatic about what that means: "Proposals are
 * inert. They are not readable by the rule engine, not visible to
 * gardeners, and not exportable until a human reviewer accepts or corrects
 * them." Everything this port produces lands as
 * `awaiting_horticultural_review`, which the rule-facing read treats as
 * absent. Nothing here can change a recommendation.
 *
 * NOT DURING A USER REQUEST, ever. ADR-0013: both permitted modes "happen
 * before publication and neither of which happens during a user request".
 * The caller is a scheduled sweep phase, never a route.
 *
 * WHAT IT MAY DRAFT, AND WHAT IT MAY NOT. Sowing, transplant and harvest
 * timing, days to maturity, succession interval and rotation rest — the
 * structured fields the seasonal rules consume. It may NOT draft edibility,
 * toxicity, or chemical guidance: ADR-0013 excludes those from AI authoring
 * entirely and structurally, because "review of a plausible fabrication is
 * a weaker control than authorship from a source". No field of this port
 * carries them, which is what makes that exclusion structural here rather
 * than an instruction a prompt could drift away from.
 *
 * A MODEL THAT DOES NOT KNOW MUST SAY SO. Every timing field is nullable
 * and `declined` is a first-class outcome. A crop with no succession
 * benefit and a crop the model cannot speak to must be able to produce
 * different results, and neither may be filled in with a plausible number.
 *
 * No registry, for the same reason `ai-explanation-provider.ts` has none:
 * ADR-0008 commits the platform to Vertex AI, so one port with one adapter
 * is the honest shape and a registry of alternative vendors would be dead
 * machinery.
 *
 * Source: ADR-0013-ai-assisted-care-content-authoring.md;
 * architecture/recommendations-and-ai.md, sections "8. Vertex AI Boundary"
 * and "9. Structured Output".
 */

/** What the model is asked about — a taxon's names and nothing else about any garden. */
export interface SeasonalTimingProposalRequest {
  readonly scientificName: string;
  readonly commonName: string | null;
  readonly family: string | null;
  /** Timing genuinely differs by hemisphere, so it is part of the question rather than something to be mirrored afterwards. */
  readonly hemisphere: 'northern' | 'southern';
}

/**
 * The drafted timing. Months are `1`-`12`; every field is nullable and a
 * `null` means the model did not claim a value, never a default.
 */
export interface SeasonalTimingDraft {
  readonly sowIndoorsStartMonth: number | null;
  readonly sowIndoorsEndMonth: number | null;
  readonly sowOutdoorsStartMonth: number | null;
  readonly sowOutdoorsEndMonth: number | null;
  readonly transplantStartMonth: number | null;
  readonly transplantEndMonth: number | null;
  readonly harvestStartMonth: number | null;
  readonly harvestEndMonth: number | null;
  readonly daysToMaturityMin: number | null;
  readonly daysToMaturityMax: number | null;
  readonly successionIntervalDays: number | null;
  readonly rotationRestSeasons: number | null;
}

export type SeasonalTimingProposalOutcome =
  | { readonly kind: 'drafted'; readonly draft: SeasonalTimingDraft }
  /** The model had nothing it was willing to claim for this taxon. A legitimate answer, not an error. */
  | { readonly kind: 'declined'; readonly reason: string }
  /** Transport, schema or safety refusal — the adapter's own typed failure, never a partial draft. */
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface SeasonalTimingProposalProvider {
  /**
   * Drafts timing for one taxon. `signal` aborts when the caller's bounded
   * deadline elapses; an adapter must never outlive it.
   */
  proposeSeasonalTiming(
    request: SeasonalTimingProposalRequest,
    signal: AbortSignal,
  ): Promise<SeasonalTimingProposalOutcome>;
}
