# ADR-0008: Rules-First Recommendations with Vertex AI Explanations

> Status: Accepted  
> Date: July 21, 2026

## Context

Garden recommendations must be explainable, versioned, and safe. Generative models are useful for natural-language synthesis but must not invent garden facts or become the sole authority for chemical, toxicity, or safety guidance.

## Decision

Generate recommendation candidates from deterministic, versioned rules and structured horticultural knowledge. Use Vertex AI through an application-owned provider adapter for bounded classification, extraction, or explanation tasks after evaluation. Store evidence, rule version, model configuration, confidence, and user outcome.

PostgreSQL structured search is the initial knowledge retrieval mechanism. `pgvector` may be added after a measured retrieval use case is approved.

## Consequences

- Recommendations remain available when the generative provider is unavailable.
- Generated text cannot add unsupported actions or facts.
- Model and prompt changes require evaluation and versioning.
- Sensitive raw prompts and responses are not logged indiscriminately.
- A different provider can replace Vertex AI behind the adapter without changing domain semantics.
