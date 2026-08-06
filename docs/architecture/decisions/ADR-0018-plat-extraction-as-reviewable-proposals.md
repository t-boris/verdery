# ADR-0018: A Surveyor's Plat Is Read Into Reviewable Proposals, Not Into Accepted Geometry

> Status: Accepted
> Date: August 6, 2026

## Context

An owner uploaded a real plat of survey — `7612 Cascade Way, Gurnee, Illinois`, one scanned page —
and then had to trace it by hand over a 20×20 m placeholder square, after calibrating it against
two distances read off the drawing with a ruler tool. Their question was the obvious one: the
document already states everything, so why is a person retyping it?

They are right about the document. A plat of survey carries, in machine-readable text:

- **Bearings and distances for every lot line** — `RECORD = N 46°54'11" E, MEASURED = 135.06`,
  `S 44°55'39" E, 70.02`, `N 43°12'31" E, 135.10`, and a curve along the road with
  `RADIUS = 1226.00, ARC = 78.67, CHORD = 78.66`. Four calls close a polygon exactly. Traced by
  hand, the same boundary is a guess with a metre of slop per corner.
- **A north arrow**, and bearings that define true north independently of it.
- **The street address** (`7612 CASCADE WAY, GURNEE, IL 60031`) and the parcel number
  (`07-19-201-008`).
- **Labelled building dimensions** — `28.6`, `34.3`, `19.6`, `51.0`, `17.0`, `20.2`, `12.7` — for the
  house, the covered porch, the wood deck, the driveway and the walk.

What it does NOT carry is a latitude or longitude. A plat is a relative survey: bearings and
distances from monuments, referenced to a recorded subdivision. Geographic position comes from
somewhere else — and this product already has that somewhere else, the US Census geocoder behind
`AddressGeocoder`, which turns the address printed on the plat into a coordinate.

The architecture has been shaped for this since before it was asked for, and the shape has stood
empty:

- `architecture/garden-capture-and-scan.md` specifies a proposal/review pipeline: a processor maps
  extracted candidates into "immutable typed proposal packages with confidence, provenance,
  alignment, previews, limitations, and processor versions".
- `decideProposal` exists across the contract, the API and both clients, and **nothing has ever
  produced a proposal for it to decide**.
- The product principle is already written: "imported, scanned, inferred, or AI-generated objects
  are proposals until accepted by the user" (`architecture/README.md`, "User-Controlled
  Automation"), and "accepted data before generated data" (implementation-plan.md).

## Decision

**A plat is read by a vision model into a typed proposal package, and a person accepts it object by
object. No extracted value ever becomes accepted geometry on its own.**

Three stages, in this order, each shippable and each verifiable against a real document:

### Stage 1 — Where the garden is, and which way it faces

The model reads two things off the page: the street address, and true north (from the bearings,
with the north arrow as a cross-check). The address goes through the existing geocoder — provider
isolation unchanged, no new provider — and the result is offered as a **prefilled, unsaved**
location: coordinates, rotation, and the sentence that says where each number came from. The person
presses save, or edits first, or ignores it entirely.

Why this first: it is the smallest thing that removes real work, it reuses a geocoder that already
exists, and every number it produces is one a person can check against the drawing in front of them.

### Stage 2 — The lot boundary, computed rather than traced

The model reads the boundary calls — bearing, distance, and curve parameters per segment — as TEXT.
The polygon is then computed by ordinary trigonometry from those calls, not drawn by the model:
a closing error is measurable, and a traverse that fails to close within tolerance is reported
instead of silently smoothed. The result is a proposal for one `lot` object, carrying its own
closure error so the person accepts a boundary whose accuracy is stated.

This is the stage that justifies the whole capability. A computed boundary is exact where a traced
one is approximate, and everything else on the map inherits that accuracy.

### Stage 3 — Structures, hardscape, and the rest

House, deck, porch, driveway, walk, easements: read as labelled dimensions and positions, proposed
with per-object confidence, accepted or rejected individually. Lower confidence than Stage 2 by
nature — a dimension string on a drawing does not say which edge it measures — so these are
proposals over a calibrated backdrop the person is already looking at, never a silent write.

### What holds in every stage

- **Proposals, never writes.** Extraction produces a proposal package. `decideProposal` — built,
  tested, and idle since Phase 6 — is what turns any of it into garden objects.
- **Provenance on every accepted object.** `imageExtraction` already exists as a `ProvenanceKind`;
  an object accepted from a plat carries it, alongside the processor and model version, so a later
  reader can tell a surveyed line from a hand-drawn one.
- **The original document is the evidence.** The rendered plan stays on the map as the backdrop the
  proposal is reviewed against. A proposal a person cannot compare with the drawing is a proposal
  they cannot honestly accept.
- **Accuracy is stated, not implied.** Distances from a plat are survey-grade; a bearing misread by
  the model is not. Closure error for the traverse, and per-object confidence for everything else,
  are shown at review time and stored with the accepted object.
- **No new provider.** Vertex AI is already the approved vision provider (ADR-0008, ADR-0015) behind
  an application-owned adapter, with the kill switch, quota and timeout that adapter already
  enforces. The geocoder is the one the location panel already uses.

## Consequences

- The first real producer for `decideProposal` arrives, and the proposal pipeline stops being a
  designed-but-empty shape.
- A plat becomes worth uploading for more than tracing: the boundary it yields is better than the
  one a person can draw over it.
- Model output enters a review surface, not the domain. The failure mode of a bad extraction is a
  rejected proposal, not a wrong garden.
- Scope for extraction is a US residential plat of survey. Other document classes — a landscape
  design, an architect's site plan, a hand sketch — are out of scope until one is evaluated, and the
  interface says which document it can read rather than failing mysteriously on the others.

## Alternatives Considered

- **Extract straight into accepted objects.** Faster to build and contrary to a principle this
  product has held from the start. A survey drawing is trusted precisely because a human signed it;
  a model's reading of it has not been signed by anyone.
- **Ask the model for the polygon directly, in coordinates.** Rejected for Stage 2: a model that
  outputs geometry hides its arithmetic, and closure error — the survey's own built-in check —
  disappears with it. Reading the calls as text and computing the traverse keeps that check.
- **Wait for the Phase 10 capture research gate (ADR-0014).** That gate governs capture from the
  world — photographs, AR, LiDAR — where ground truth is expensive and precision unknown. A plat is
  a document with printed numbers on it; the honest comparison is document extraction, which this
  ADR authorises on its own terms, with the same proposal/review discipline the gate exists to
  protect.
