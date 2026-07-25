# AI-explanation evaluation fixtures (P7-AI-01)

This directory is the **versioned, bilingual evaluation dataset** for the bounded Vertex AI
explanation embellishment — `recommendations-and-ai.md` section 16's "Evaluation and Release"
requirements, built as runnable fixtures the same way `tests/rule-fixtures/` is the rule
engine's reviewable acceptance artifact.

## What one fixture is

One constructed model draft (the text a model COULD return, in English or Russian) evaluated
against one launch rule's REAL deterministic baseline — the rule's own `explanationTemplate`
rendered through the real `renderRuleExplanation`, plus the rule's own `actionTitle` — through
the REAL validation pipeline (`validateAiExplanationDraft`, the exact function the
embellishment use case runs in production). The expected verdict is pinned with deep equality:
accepted text verbatim, or the rejection outcome plus its diagnostic detail. Nothing about the
validation escapes the fixture.

Every fixture carries `reviewNotes` naming the judgment it embodies, for the human reviewer.

## Section 16 mapping

| Section 16 requirement                  | Where it lives here                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Versioned evaluation dataset            | These files, in git, evolving only by reviewed edit                                                              |
| Expected structured outcomes            | Each fixture's pinned verdict                                                                                    |
| Factuality and unsupported-claim checks | The `unsupported_fact` / `unknown_evidence_reference` cases                                                      |
| Safety tests                            | The `prohibited_content` cases (chemical, disease, medical, electrical) and the prompt-injection-shaped case     |
| Russian and English quality evaluation  | Every rule has accepted AND rejected cases in BOTH languages (the harness's own meta-test enforces this)         |
| Latency and cost budgets                | Not here — enforced structurally by `GenerateAiExplanation` (per-call deadline, call budget) and its unit tests  |
| Comparison with deterministic fallback  | Every fixture IS that comparison: the baseline is in the input, and every rejection means the baseline is served |
| Human review before release             | **Not satisfiable by this harness — see below**                                                                  |

## What the HUMAN evaluation pass adds (and why this harness cannot replace it)

The harness proves the machinery: schema bounds, evidence-reference discipline, the bilingual
action/prohibited lexicons, number-invention detection, the length bound. It deliberately does
NOT claim to prove **quality** or **completeness**:

- The lexicons are finite. Spelled-out numerals ("two liters", «два литра») and action
  phrasings outside the concept lists pass undetected — the lexicon's documented bias is
  over-rejection, never under-rejection, but a sufficiently novel phrasing is a residual risk
  only human review of REAL model outputs can assess.
- No fixture can judge whether accepted embellishments are actually GOOD Russian or English —
  fluent, warm, faithful in tone. That is section 16's human quality evaluation.
- The fixtures are constructed drafts, not recorded Vertex outputs: no Vertex access is enabled
  in any environment yet. Before live enablement, a human evaluation pass over REAL model
  outputs for every launch rule, in both languages, against this same pipeline, is required —
  the release gate recorded in `docs/development/deferred-capabilities.md`, exactly the
  `awaiting_horticultural_review` honesty posture the rule catalog itself ships with.

## Sign-off procedure

A reviewer reads each fixture file top to bottom: the baseline construction in
`fixture-support.ts` (are the representative facts sensible?), then each case's draft,
verdict, and `reviewNotes` (is the judgment right? is anything missing?). New adversarial
ideas become new fixtures in the rule's file. Widening or narrowing the lexicons
(`ai-explanation-lexicon.ts`) is a reviewed code edit whose effect these fixtures pin —
and whose category alignment with the rule layer's `EXCLUDED_RULE_CONTENT_CATEGORIES` is
pinned by `src/modules/tasks-recommendations/domain/ai-explanation-lexicon.test.ts`. The
consolidated safety review entry point (tier model, excluded categories, per-rule ledger,
sign-off protocol) is `docs/development/recommendation-safety-catalog.md` (P7-SAFE-01);
this harness's human evaluation pass is the separate, additional gate for live Vertex
enablement.
