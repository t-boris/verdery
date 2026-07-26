# ADR-0013: AI-Assisted Care Content Authoring, Never Runtime Care Authority

> Status: Accepted
> Date: July 26, 2026

## Context

`P0-PROV-01` selected free-only sources for plant content: World Flora Online for the taxonomy
spine, USDA PLANTS for United States names and native/noxious/invasive status, USDA Characteristics
for care attributes, Wikidata and USDA GRIN for cultivars, and self-hosted hardiness-zone rasters.
No commercial care-attribute vendor was licensed.

That choice leaves a measured gap. USDA Characteristics covers roughly 2,186 taxa against 93,157
checklist names — about 2.3% — and the covered set is selected for conservation and agronomy rather
than for gardening. Most ornamental plants a gardener actually plants have no structured care
attributes from any free source. The deterministic rule engine consumes structured fields, not
prose, so an empty attribute is not a degraded recommendation; it is no recommendation at all.

A generative model is already integrated: Vertex AI behind an application-owned adapter with a
default-off kill switch, bounded schemas, and adversarial fixtures. The obvious temptation is to ask
it, at request time, how much water a plant needs.

That temptation must be refused, and the reason is already recorded. ADR-0008 states that
generative models "must not invent garden facts or become the sole authority for chemical,
toxicity, or safety guidance," and that "generated text cannot add unsupported actions or facts."
A model answering a care question from its own weights is exactly the prohibited case. It is also
incompatible with the provider-content model, which requires every stored record to carry source,
version or fetch time, attribution, jurisdiction, and allowed presentation behavior. A model
response has none of these; writing one into those fields records a provenance that does not exist.

Care data additionally includes edibility and toxicity. A fabricated "edible" is not an inaccurate
suggestion but a health harm.

ADR-0008 does, however, permit Vertex AI for "bounded classification, extraction, or explanation
tasks after evaluation." Extraction is the operative permission, and it is what makes a lawful path
available.

## Decision

Generative models may participate in producing care attributes in exactly two ways, both of which
happen before publication and neither of which happens during a user request.

### Permitted: extraction from licensed source text

A model may parse a text we are licensed to use — a Wikipedia article under CC BY-SA, a USDA
document in the public domain — and emit the structured fields the rule engine consumes: sunlight,
water, hardiness range, mature size, growth habit, bloom and harvest timing.

In this mode the model is a parser, not an author. The stored record's source remains the underlying
text, with that text's own license, attribution, jurisdiction, and version. The extraction is
recorded as processing applied to a source, in the same way unit conversion is recorded as
processing applied to a weather reading. A field the source text does not support must be left
empty; the model may not supply a value the text does not contain.

### Permitted: proposal into a human review queue

A model may propose care attributes for a plant with no licensed source, as a bulk offline authoring
pass. Proposals are inert. They are not readable by the rule engine, not visible to gardeners, and
not exportable until a human reviewer accepts or corrects them.

Once accepted, the record is **our own authored content**, and its provenance says so: authored by
this project, AI-assisted, reviewed by a named reviewer on a date, against a recorded model and
prompt version. This is not a way to acquire someone else's data without licensing it; it is
ordinary authorship with a drafting aid, and it is recorded as such.

### Excluded from AI authoring entirely

Edibility, toxicity, and any chemical-application guidance are authored by a human from a cited
source. No model proposal may populate them, and no reviewer may accept a proposal into them,
because review of a plausible fabrication is a weaker control than authorship from a source. This
exclusion is structural, not a reviewer instruction.

### Prohibited: runtime care authority

No user-facing request path may consult a generative model for a care fact. When no attribute
exists, the system reports that no attribute exists — the honest degradation the integration layer
already models. An absent recommendation is correct; an invented one is not.

## Consequences

- The ornamental care gap closes over time through reviewed authoring rather than through a
  recurring vendor subscription, at a one-time cost in review effort.
- Recommendations remain deterministic and explainable. Nothing the rule engine reads was produced
  by a model at request time, so ADR-0008's availability and explainability guarantees survive
  unchanged.
- Provenance stays truthful in both directions: extracted records point at a real licensed source;
  authored records claim authorship rather than borrowing a source that does not exist.
- A review queue, reviewer identity, and an accept/correct/reject workflow become required
  infrastructure. Proposals must be storage-separated from published attributes so that "not yet
  reviewed" cannot be read as "known."
- Model and prompt versions must be recorded per proposal, so a later evaluation regression can
  identify which accepted records were drafted under a suspect configuration.
- Coverage growth is bounded by reviewer throughput, and the catalogue will be visibly uneven for a
  long time. This is preferable to uniform coverage of unknown accuracy.
- Licensing a commercial care-attribute vendor later remains a pure addition: one more adapter in
  the existing registry, with no change to what is already stored.

## Rejected Alternatives

- **Query the model at request time and cache the answer:** rejected. Caching a fabrication does not
  make it sourced, and it would write unverifiable claims into fields defined to carry provenance.
- **Query the model at request time and label the answer as AI-generated:** rejected. A label
  transfers the verification burden to the gardener, who cannot discharge it, and it does not make
  a toxicity error safe.
- **Accept model proposals automatically and review only on complaint:** rejected. Complaint-driven
  review means the first detector of a toxicity error is the person harmed by it.
- **Ship with the sparse free data and no authoring at all:** rejected as the permanent answer,
  since it leaves most ornamentals without recommendations, but it remains the correct behaviour for
  any attribute not yet reviewed.
- **Use the model to translate an unlicensed vendor's data into our schema:** rejected. Extraction
  launders nothing; the source license governs regardless of the transformation applied.
