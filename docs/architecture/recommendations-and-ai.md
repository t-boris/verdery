# Recommendations and AI Design

> Status: Draft 0.1  
> Decision status: Approved baseline  
> Last updated: July 21, 2026

## 1. Purpose

This document defines how Grow Garden generates explainable care recommendations and uses Vertex AI without making generative output the source of horticultural truth.

## 2. Principles

- Structured garden facts and versioned rules produce recommendation candidates.
- Generative models may classify, summarize, or explain within bounded contracts.
- Recommendations preserve evidence, uncertainty, and version history.
- The user controls completion, postponement, rejection, and feedback.
- Safety-critical guidance requires additional policy and expert review.
- Core recommendations remain available during model-provider outage.

## 3. Recommendation Pipeline

```text
garden facts + weather + care history + knowledge rules
                         │
                         ▼
                candidate generation
                         │
                         ▼
             eligibility and safety filters
                         │
                         ▼
             priority and timing calculation
                         │
                         ▼
        optional Vertex AI bounded explanation
                         │
                         ▼
         persisted recommendation with evidence
                         │
                         ▼
                user action and feedback
```

## 4. Structured Inputs

Inputs may include:

- Plant identity and confidence.
- Garden location, time zone, and season.
- Weather observations and forecast freshness.
- Soil or moisture facts when available.
- Recent observations and tasks.
- Plant lifecycle stage.
- Garden geometry and exposure context where reliable.
- User preferences and capability constraints.
- Horticultural rule and content versions.

Missing facts remain missing. The system does not invent a value to complete a recommendation.

## 5. Rule Engine

Rules are versioned application-owned definitions containing:

- Eligibility conditions.
- Required and optional evidence.
- Time window and recurrence behavior.
- Priority inputs.
- Exclusion and safety conditions.
- Suggested action template.
- Explanation facts.
- Regional or plant applicability.
- Content and reviewer metadata.

Rules execute deterministically for the same versioned inputs.

## 6. Candidate Lifecycle

```text
generated → eligible → presented → completed
                      ├──────────→ postponed
                      ├──────────→ rejected
                      ├──────────→ expired
                      └──────────→ superseded
```

Presentation does not overwrite generation evidence. A superseding recommendation references the prior record.

## 7. Priority

Priority is an explainable score or ordered category derived from:

- Urgency window.
- Plant impact.
- Confidence.
- Weather opportunity or risk.
- User effort and availability.
- Existing task overlap.
- Safety and seasonal constraints.

The application stores the factors needed to explain rank. A black-box ranker may be evaluated later but does not replace baseline explanations without an ADR.

## 8. Vertex AI Boundary

Vertex AI is accessed through an application-owned adapter. Approved initial tasks may include:

- Converting evidence into concise natural-language explanation.
- Classifying user observations into a controlled taxonomy.
- Extracting structured candidates from approved content.
- Conversational answers constrained by retrieved garden facts.

The adapter defines model identifier, region, timeout, token budget, structured response schema, safety settings, and data-retention policy.

## 9. Structured Output

Model calls use strict schemas where available. A model response is rejected or repaired through a bounded deterministic process if it:

- Fails schema validation.
- References unknown garden facts.
- Introduces an unsupported action.
- Contradicts safety filters.
- Exceeds uncertainty rules.
- Contains prohibited content.

Free-form model text never executes commands directly.

## 10. Explanation Generation

The model receives a minimal evidence packet containing stable fact identifiers and approved phrasing constraints. The final record stores:

- Evidence references.
- Rule version.
- Prompt-template version.
- Model and configuration version.
- Generated text.
- Validation outcome.
- Fallback deterministic text.

If generation fails, the deterministic explanation is shown.

## 11. Knowledge Retrieval

Initial retrieval uses structured PostgreSQL data, full-text search, trigram matching, and explicit relationships.

`pgvector` is deferred until evaluation demonstrates a corpus and retrieval task where semantic similarity materially improves quality. Adding vectors requires content-version, deletion, embedding-provider, and rebuild design.

## 12. Conversational Assistant

The assistant uses a server-side tool boundary and retrieves only gardens authorized to the current actor.

It may:

- Answer questions from known garden facts.
- Explain current tasks and recommendations.
- Summarize history.
- Suggest a draft observation or task for user confirmation.

It may not:

- Mutate the garden without explicit confirmation.
- Claim a plant fact that is not known or clearly presented as general guidance.
- Bypass chemical or safety policy.
- Access another garden through prompt content.

## 13. Safety Tiers

### Ordinary Care

Watering, routine pruning timing, observation reminders, and general maintenance can use the standard rule and explanation pipeline.

### Elevated Risk

Disease diagnosis, toxicity, pest treatment, fertilizer concentration, and weather hazards require higher confidence, clear uncertainty, and reviewed sources.

### Restricted

Chemical application, emergency, legal-boundary, structural, electrical, and medical guidance require dedicated policy and may be excluded from generated recommendations.

## 14. Provider Failure

- Rule generation continues.
- Existing recommendations remain accessible.
- Deterministic explanation is used.
- Calls retry only for safe transient outcomes.
- Provider outage is visible operationally but does not block unrelated garden use.

## 15. Privacy

- Send only required facts to Vertex AI.
- Exclude raw private media unless the approved use case explicitly requires it.
- Do not use user data for model training without separate consent and governance.
- Redact identifiers unnecessary for inference.
- Keep prompts and responses out of ordinary logs.
- Apply deletion and retention to stored AI artifacts.

## 16. Evaluation and Release

Every model-enabled use case has:

- Versioned evaluation dataset.
- Expected structured outcomes.
- Factuality and unsupported-claim checks.
- Safety tests.
- Russian and English quality evaluation.
- Latency and cost budgets.
- Comparison with deterministic fallback.
- Human review before release.

Model changes deploy behind a versioned feature flag and controlled rollout.

## 17. Observability

Measure without logging private content:

- Calls, latency, model version, and token/cost estimate.
- Schema-validation failure.
- Fallback rate.
- Safety-filter outcome.
- User completion, postponement, and rejection.
- Recommendation freshness and duplication.
- Provider quota and error rate.

## 18. Testing

- Deterministic rule fixtures.
- Missing and contradictory inputs.
- Weather staleness.
- Model schema violation.
- Hallucinated fact rejection.
- Safety-tier enforcement.
- Provider timeout and outage fallback.
- Prompt injection through notes or imported content.
- Cross-garden authorization.
- Russian and English output.
- Model-version replay and audit.

## 19. Completion Criteria

- Every recommendation references structured evidence and a rule version.
- The application functions when Vertex AI is unavailable.
- Generated text cannot add unsupported actions.
- Sensitive content is minimized and not logged.
- Model changes are evaluated, versioned, and reversible.
- User outcomes feed product quality analysis without becoming unreviewed training data.
