# Plant knowledge provider runbooks (P11-PROV-01)

The single authoritative document naming, for each ADR-0016-selected plant-knowledge source,
the real access mechanism, authentication, license, rate limits, and bulk-download fallback —
so `P11-ASYNC-01`'s adapters are built against verified endpoints, never guessed ones. Mirrors
[recommendation-safety-catalog.md](recommendation-safety-catalog.md)'s role as "the single
document a reviewer reviews against," applied to provider legal/access decisions instead of
rule safety.

**Review status: AWAITING owner review of the two items §7 names** (a commercial care-content
vendor beyond the free baseline, and the USDA hardiness-map attribution obligation this
research surfaced). Every other decision below is either already made (ADR-0013, ADR-0016) or
requires no further sign-off: every source in §§2–6 is free, requires no API key, and carries
no automated-use restriction beyond ordinary attribution.

Every endpoint below was verified by a live request during this session (2026-07-29), not
copied from vendor marketing pages — each entry says so explicitly and gives the real request
that was run. Two sources (identification, care-attribute extraction) reuse machinery already
built in Phase 10 and P7-INT-02, respectively; they are not re-verified here.

## 1. Scope

Knowledge classes and their ADR-0013/ADR-0016-selected source, per
[architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md](../architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md):

| Knowledge class                  | Source                                  | Runbook              |
| -------------------------------- | --------------------------------------- | -------------------- |
| Taxonomy spine                   | World Flora Online                      | §2.1                 |
| US names, native/invasive status | USDA PLANTS                             | §2.2                 |
| Care attributes                  | USDA PLANTS Characteristics             | §2.2                 |
| Cultivars, synonyms              | Wikidata                                | §2.3                 |
| Cultivars (accession data)       | USDA GRIN                               | §2.4                 |
| Hardiness/climate                | USDA Plant Hardiness Zone Map           | §2.5                 |
| Occurrence evidence              | GBIF                                    | §3.1                 |
| Phenology                        | USA-NPN                                 | §3.2                 |
| Soil context                     | USDA NRCS Soil Data Access              | §3.3                 |
| Federal/state regulatory         | eCFR (7 CFR §360.200)                   | §3.4                 |
| Identification                   | Vertex AI (already built, P10/ADR-0015) | not re-verified here |

## 2. ADR-0013's original selection

### 2.1 World Flora Online (taxonomy spine)

- **Real API, verified live.** Name matching: `GET https://list.worldfloraonline.org/matching_rest.php?input_string={name}` returns `wfo_id`, `full_name_plain`, classification `placement`, and `candidates[]` for ambiguous input. A GraphQL endpoint also exists at `POST https://list.worldfloraonline.org/gql.php` (root fields `classifications`, `taxonNameById`, `taxonConceptById`, `taxonNameMatch`) — better suited to fetching accepted name + synonym set + family in one call.
- **Auth/limits:** none found. No key, no documented rate limit, no automated-use restriction located.
- **Bulk fallback:** a versioned Darwin Core Archive backbone download exists
  (`https://files.worldfloraonline.org/files/WFO_Backbone/_WFOCompleteBackbone/archive/WFOTaxonomicBackbone_v.2.1_20240309.zip`,
  also mirrored on Zenodo), useful for a one-time or periodic full-checklist seed independent
  of live per-taxon calls.
- **License: CC BY 4.0 — corrected 2026-08-01, not CC0.** The site's own footer
  (`worldfloraonline.org`, every page) states "Unless otherwise noted, text and images are
  licenced: CC BY 4.0" and gives a recommended citation form: _"WFO (2026): World Flora Online.
  Published on the Internet; http://www.worldfloraonline.org. Accessed on: \[date]."_ This
  earlier CC0 reading (originally "confirmed on the site's own download page") is superseded by
  the live footer; CC BY 4.0 requires attribution, unlike CC0. `world-flora-online-registration.ts`
  (P11-PROV-01) is built against this corrected reading and carries a non-null `attributionText`.

### 2.2 USDA PLANTS (US names/status) and USDA PLANTS Characteristics (care attributes)

- **Real API, verified live, but undocumented/unannounced.** The public site
  (`plants.usda.gov`) is an Angular SPA backed by
  `https://plantsservices.sc.egov.usda.gov/api/`, which serves a raw OpenAPI 3.0.4 spec at
  `/swagger/v1/swagger.json` with no linked Swagger UI — this looks like an internal API the
  frontend calls, not a published integration point. Verified real calls and real data:
  - `POST /api/plants-search-results` with `{"Text":"Quercus alba","Field":"Scientific Name","Type":"Basic","pageNumber":1}` → accepted-name/synonym candidates.
  - `GET /api/PlantProfile?symbol=QUAL` → `NativeStatuses` (region/status/type), `Durations`, `GrowthHabits`, plus flags pointing at noxious/invasive detail endpoints.
  - `GET /api/PlantNoxiousStatus/{id}` / `GET /api/PlantInvasiveStatus/{id}` → per-state status arrays (verified against a real species: purple loosestrife, id 84414, showing Alabama Class B noxious and Michigan "Invasive, Restricted").
  - `GET /api/PlantCharacteristics/{id}` → the Characteristics dataset ADR-0013 selected for care attributes: flat `{name, value, category}` triples (Growth Habit, Duration, Active Growth Period, and more).
- **Auth/limits:** none observed (no cookies, no headers, no key needed for any call above).
  **No documented rate limit and no published terms for this specific API** — it was found by
  inspecting the site's own network traffic, not by reading integration documentation, because
  none exists. Build the adapter defensively (generous timeouts, tolerant parsing, a fallback
  to the bulk checklist below) and treat this as a source that can change or disappear without
  notice.
- **Bulk fallback (name/family/synonym only, no status or characteristics):**
  `https://plants.sc.egov.usda.gov/DocumentLibrary/Txt/plantlst.txt` (verified live, ~7 MB,
  quoted-CSV, `Symbol,Synonym Symbol,Scientific Name with Author,Common Name,Family`).
- **License:** public domain (verified against `usda.gov/about-usda/policies-and-links`).
  Official citation form (from the PLANTS Help page): _"Natural Resources Conservation
  Service. PLANTS Database. United States Department of Agriculture. Accessed \[date], from
  https://plants.usda.gov."_ Caveat: individually-credited photos elsewhere on the PLANTS site
  may be separately copyrighted — this does not apply to the taxonomic/status/characteristics
  data above, only to any imagery this source is never used for (image sourcing is a separate,
  undecided commercial question, §7).

### 2.3 Wikidata (cultivars, synonyms)

- **Real API, verified live.** REST search:
  `GET https://www.wikidata.org/w/api.php?action=wbsearchentities&search={name}&language=en&format=json`.
  SPARQL for structured queries (e.g. cultivars of a species):
  ```sparql
  SELECT ?cultivar ?cultivarLabel WHERE {
    ?cultivar wdt:P31 wd:Q4886;        # instance of: cultivar
              wdt:P171 wd:{parentQID}. # parent taxon
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } LIMIT 10
  ```
  verified against a real parent taxon, returning real cultivar names.
- **Auth/limits:** no key required. Documented etiquette (Wikidata:Data access): roughly 60s of
  SPARQL query time per minute per client (120s burst), 5 concurrent queries per IP, and a
  **required** descriptive `User-Agent` header naming the application and a contact
  URL/email — a client without one gets blocked. The adapter must set this header.
- **License: CC0**, confirmed on Wikidata's own Data Access page.

### 2.4 USDA GRIN (cultivar/germplasm accessions)

- **No real public API.** GRIN-Global's SOAP/WCF web services are documented for
  genebank-to-genebank deployments, not exposed publicly on `npgsweb.ars-grin.gov`. The public
  surface is a search UI only (`https://npgsweb.ars-grin.gov/gringlobal/search`), with no
  confirmed bulk export format.
- **Usable alternative:** GBIF republishes GRIN's _taxonomy_ (not accession/germplasm data) as
  a checklist dataset with a real bulk download —
  `https://hosted-datasets.gbif.org/datasets/grin.zip` (COLDP format, DOI `10.15468/ao14pp`,
  discoverable via `https://api.gbif.org/v1/dataset/66dd0960-2d7d-46ee-a491-87b9adcfe7b1`).
- **Recorded gap, not silently dropped:** true germplasm/accession-level cultivar data has no
  clean automated path today. `P11-ASYNC-01` should treat GRIN as **deferred** — Wikidata
  already covers common cultivar names — rather than build UI scraping against a site with no
  documented automated-access terms either way.
- **License:** USDA/ARS public domain for the taxonomy GBIF republishes; no separate terms
  confirmed for GRIN-Global's own site.

### 2.5 USDA Plant Hardiness Zone Map (hardiness/climate, "self-hosted rasters")

- **Real download, but NOT simple public domain — a genuine finding this research
  surfaced.** The map is jointly produced by USDA-ARS and Oregon State University's PRISM
  Climate Group; GIS layers (raster, shapefile, KML, ZIP-code CSV; 800 m resolution for
  CONUS/Alaska, 400 m for Hawaii/Puerto Rico in the 2023 revision) are downloadable from
  `https://prism.oregonstate.edu/phzm/`. **Oregon State University retains rights to the
  underlying data**: reproduction/redistribution is free, but any derived map **must display
  both the USDA-ARS and OSU logos**, and an altered map must carry a disclaimer that it is not
  the official USDA map.
- **What this changes:** ADR-0013's "self-hosted hardiness-zone rasters" decision stands, but
  self-hosting now has a recorded attribution obligation (logos + disclaimer on any
  garden-facing hardiness display) that was not previously written down anywhere in this
  repository. This is one of the two items §7 asks the owner to confirm — not because the data
  is unusable, but because a UI requirement (two specific logos) is a design decision, not an
  engineering one.

## 3. Four net-new sources ADR-0016 added beyond ADR-0013's scope

### 3.1 GBIF (occurrence evidence)

- **Real API, verified live.** Name → taxon key:
  `GET https://api.gbif.org/v1/species/match?name={name}` (returned real `usageKey`,
  `canonicalName`, `status`, `confidence` for a live test). Occurrence search:
  `GET https://api.gbif.org/v1/occurrence/search?taxonKey={key}&country=US&stateProvince={state}`
  — returned real records with `basisOfRecord`, `eventDate`, coordinates,
  `coordinateUncertaintyInMeters`, and **a per-record `license` field** (verified mixed
  CC0/CC-BY/CC-BY-NC values in one result set — license must be read per occurrence record,
  never assumed for the whole response).
- **Auth/limits:** no key needed for reads. No published hard rate limit; GBIF's own community
  guidance recommends the separate Downloads API (`POST /v1/occurrence/download/request`,
  requires a free registered account) for any bulk pull expected to run more than ~15 minutes.
- **License:** per-record, read from the `license` field every time — never cached as a
  dataset-wide assumption. Downloads carry a citable DOI or must be individually attributed
  per GBIF's data-use terms.
- **Reference-image selection:** the cache-aside media request reads up to 100 confirmed
  `HUMAN_OBSERVATION` records with `occurrenceStatus=PRESENT` and `country=US`. Presentation
  remains capped at eight images and selects at most one image per credited contributor. This
  is a federal provider query, not a county data source or fallback. Rows cached before this
  scope was introduced are retained for audit as rejected and refreshed from GBIF on the next
  taxon-profile read.
- **Occurrence counts are stored, never shown in the taxon profile.** The adapter writes one
  `occurrence_evidence_count` assertion nationwide plus one per `stateProvince` facet, and
  `RebuildPlantProfileVersion` excludes that fact key from every profile it assembles
  (`NON_PROFILE_FACT_KEYS`). Three reasons, all of which held the moment a real taxon was
  opened: ADR-0016 §4 forbids reading the count as a native/introduced/invasive/regulated
  status, which is the only reading that would have helped a gardener; the facet is one row
  per region, so a common taxon rendered as fifty identically-titled rows ahead of hardiness
  and water needs; and `stateProvince` is free text, so those rows carried "Ca", "Dallas" and
  "New mexico" beside "New Mexico". The assertions remain on record as evidence — this is a
  projection rule, not a deletion.

### 3.2 USA-NPN (phenology)

- **Real API, verified live.** Species catalog:
  `GET https://services.usanpn.org/npn_portal/species/getSpecies.json`. Phenology summary:
  `GET https://services.usanpn.org/npn_portal/observations/getSummarizedData.json?start_date=...&end_date=...&species_id=...`
  — returned real per-individual `first_yes_date`/`last_yes_date`/`phenophase_description`
  records with site geography.
- **Auth/limits:** no key for reads (OAuth exists only for writing observations, not relevant
  here). The API spec marks a `request_src` free-text client identifier as required for the
  summary endpoint, though a live test without it still returned data — set it anyway, since
  the spec calls it required and it costs nothing to include.
- **License:** Terms of Use require attribution/citation with a source URL; the two linked
  detail policies (Data Use Policy, Data Attribution Policy) were not independently reachable
  this session — attribution text should be reconfirmed against those before enabling this
  source outside development.

### 3.3 USDA NRCS Soil Data Access (soil context)

- **Real API, verified live.** `POST https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest`
  with a SQL-like `query` field and `"format":"JSON"`. Verified end-to-end for a real
  coordinate: a spatial intersection query (`SDA_Get_Mukey_from_intersection_with_WktWgs84`)
  correctly returned the real map unit for a Story County, Iowa point ("Nicollet loam"), and a
  follow-up `component`/`chorizon` join by `mukey` returned real drainage class
  ("Somewhat poorly drained") and pH range fields (`ph1to1h2o_l/_r/_h`).
- **Auth/limits:** none. Documented cap: 100,000 rows / 32 MB JSON per query — every query
  must bound its own result set (the intersection-then-join pattern above already does).
- **Bulk fallback:** gSSURGO/SSURGO full-database snapshots (state or CONUS-wide File
  Geodatabase/shapefile packages) via the NRCS Geospatial Data Gateway.
- **License:** public domain (17 U.S.C. §105), standard USDA disclaimer only.

### 3.4 Federal/state regulatory status

- **APHIS itself publishes no API or structured data** — verified: the current Federal Noxious
  Weed List page (`aphis.usda.gov/organism-soil-imports/federal-noxious-weeds`) links only to
  PDFs, and the legacy PLANTS-hosted noxious-list endpoint
  (`plantsorig.sc.egov.usda.gov/java/noxious?rptType=Federal`) is dead (connection failed).
- **Real, structured alternative: the eCFR API.** The Federal Noxious Weed List is codified at
  7 CFR §360.200, and `https://www.ecfr.gov/api/versioner/v1/full/{date}/title-7.xml?part=360`
  returns the current species list as structured XML — verified live, real species (e.g.
  _Hydrilla verticillata_) present in the `DIV8 N="360.200"` block. This is the authoritative,
  versioned, government-hosted source for federal regulatory status, not a scrape of APHIS's
  own PDF.
- **Auth/limits:** no key needed for the calls made. Rate-limit/ToS page returned a redirect
  during this research and was not independently confirmed — treat as unconfirmed, not as "no
  limit."
- **License:** public domain federal regulatory text.
- **State-level regulatory status** (invasive/noxious lists vary by state) has no single
  federal source and is **not covered by this runbook** — USDA PLANTS's own per-state
  noxious/invasive endpoints (§2.2) already cover the state dimension for species PLANTS
  tracks, which is the practical answer for now; a dedicated state-by-state survey is not
  scoped into P11-PROV-01.

## 4. Identification (already built)

Photo-based species identification reuses the real, tested, kill-switched Vertex AI adapter
`identify-plant-species.ts` (P10/ADR-0015) — no new provider decision or verification needed.

## 4a. Three provenance fields, and which one a reader sees

Every plant-assertion provider registration carries three pieces of text that
are easy to confuse and were confused once, visibly:

| Field             | Audience                          | Where it goes                                                                                                                                                                   |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `licenseNote`     | Whoever re-checks the terms       | Nowhere user-facing. Cites repository paths and ADR sections, records when the licence was last verified, and says things like "reconfirm before enabling outside development". |
| `citationText`    | The reader                        | Snapshotted onto every assertion as `sourceCitation`. One sentence: the citation the source asks to be cited by.                                                                |
| `attributionText` | The reader, as a legal obligation | Rendered when the licence requires attribution; `null` when it does not. USDA is public domain (17 U.S.C. §105) and carries `null` here while still carrying a `citationText`.  |

`refresh-taxon-assertions.ts` used to stamp `licenseNote` as every assertion's
`sourceCitation`, and the catalog page rendered `sourceCitation` under every
fact. On a taxon with a per-state occurrence breakdown that printed the same
six-hundred-character compliance memo about fifty times, and the memo was most
of the page. Two rules follow from it:

- A citation belongs to a **source**, not to each fact. The catalog page lists
  them once, deduplicated by text.
- Compliance notes are not citations. Keep the note — it is genuinely useful to
  whoever inherits the licence question — and keep it out of the product.

## 5. Legal/privacy inventory

- Every source in §§2–6 above is a public-sector or CC0/public-domain-licensed resource; none
  requires a paid contract, an API key, or a data-processing agreement.
- No source in this runbook returns personal data about Grow Garden's own users — every call
  is keyed by scientific name, taxon ID, or geographic coordinate/region, never by a garden or
  profile identifier. Provider calls therefore carry the same privacy posture the existing
  `RefreshPlantContent`/weather-refresh adapters already have: outbound requests never include
  garden-scoped identifiers.
- Two sources (Wikidata, USA-NPN) require a descriptive User-Agent/client identifier naming
  this application — an operational requirement, not a privacy one, and cheap to satisfy.
- The USDA hardiness-map attribution obligation (§2.5) is the one source in this runbook with
  a real redistribution condition beyond ordinary citation; it is recorded here so it reaches
  UI design before launch, not discovered after.

## 6. What P11-ASYNC-01 builds against this runbook

Per ADR-0016 §5, every source above is buildable today without a commercial contract. Each
gets one real adapter behind the existing `PlantContentProviderRegistry`-style
adapter-plus-registry-entry pattern (text/characteristics sources) or a new equivalent
structured-fact port (§3's sources, which return typed facts/distribution claims, not prose) —
each adapter kill-switched by its own default-`false` flag, the same posture
`PLANT_SPECIES_AI_ENABLED` already established for Phase 10.

**Status as of P11-ASYNC-01's first pass (2026-07-31):** the structured-fact/distribution port
(`plant-assertion-provider.ts`), its registry, the fetch-and-store use case
(`refresh-taxon-assertions.ts`), and the scheduled sweep (`run-taxon-enrichment-sweep.ts`) are
built and real — plus ONE real adapter: §2.2's USDA PLANTS (names/status and characteristics
combined, since both are the same host).

**Status as of P11-PROV-01 (2026-08-01):** three more real adapters — §2.1 World Flora Online
(`world-flora-online-adapter.ts`, taxonomy-spine identity only: `searchTaxa` real,
`fetchFacts`/`fetchDistribution` structurally empty, since WFO's own GraphQL endpoint proved
undocumented and unverifiable this pass), §3.1 GBIF (`gbif-adapter.ts`, occurrence-evidence
facts only — `fetchDistribution` structurally empty per ADR-0016 §4's "never used to infer
garden suitability directly"), and §3.2 USA-NPN (`usa-npn-adapter.ts`, phenology facts for the
most recently completed calendar year; `searchTaxa` matches client-side against the full species
catalog, since the provider offers no server-side name search). All four registrations are
pushed into `composeIntegrations`'s `sourcePriority` in this order — World Flora Online, USDA
PLANTS, GBIF, USA-NPN — each still kill-switched off by default (`GBIF_PROVIDER_ENABLED`,
`USA_NPN_PROVIDER_ENABLED`, `WORLD_FLORA_ONLINE_PROVIDER_ENABLED`, all default `false`, no
environment implicitly enables any of the four). Development explicitly enables GBIF as of
2026-08-06 so an identified plant can cache licensed reference imagery from confirmed US field
observations on first read;
production remains off until configured deliberately. Development enables all four implemented
providers so the catalog can exercise taxonomy, USDA characteristics/status, occurrence imagery,
and phenology without a county-specific source. Every fetched assertion still lands
`awaiting_horticultural_review`. A cited provider assertion may be materialized for catalog display
as explicitly `source_backed`; suitability and other decision surfaces continue to require
`horticulturally_reviewed`. Human and AI proposals never become catalog facts merely by existing.
The promotion surface
now exists: `GET /v1/plant-assertion-reviews` lists every pending fact and distribution assertion
(enriched with the resolved scientific name, where a live `plant_taxonomy_mapping` row exists) and
`POST /v1/plant-assertion-reviews/:kind/:assertionId/approve` promotes one to
`horticulturally_reviewed`, stamping the calling reviewer's own verified email and the current
date. Gated by `PLANT_REVIEWER_EMAILS` (a comma-separated verified-email allowlist — empty by
default, so every environment today still refuses every reviewer, the same honest "no reviewer
configured" starting state every kill-switch in this document defaults to) rather than a
platform-wide role, since none exists yet (`docs/architecture/identity-and-authorization.md`
section 13 describes staff/support access only as an undesigned aspiration). There is no reject
path — no `rejected` review state exists in either table's own CHECK constraint — so a first pass
reviewer can only approve or leave an assertion pending.

The remaining four sources (USDA Characteristics as its own registration if ever split from USDA
PLANTS, Wikidata, hardiness rasters, USDA NRCS SDA, federal/state regulatory — five names, one
already folded into USDA PLANTS) are real, documented, implementation-ready gaps — each is the
same one-adapter-plus-one-registration shape USDA PLANTS/GBIF/USA-NPN/World Flora Online already
prove, not a stub. See `tasks/todo.md`'s own P11-ASYNC-01 review section for the fuller
accounting, including why literal Cloud Tasks/Cloud Run Job machinery (ADR-0016's own aspiration)
was deliberately NOT built this pass in favor of the same worker-interval-plus-authenticated-route
shape every other scheduled sweep in this codebase already uses.

## 7. What remains an owner decision

- **A commercial Cooperative Extension or contracted plant-content vendor** beyond the free
  baseline (design doc §5's optional row) remains undecided and unbuilt — the free-source
  profile ships without it, visibly partial where a paid source would have filled a gap, per
  ADR-0016 §5.
- **The USDA hardiness-map attribution requirement** (§2.5): confirm the exact logo/disclaimer
  placement for any garden-facing hardiness-zone display before that adapter is enabled
  outside development. This is a design/legal confirmation, not an engineering blocker — the
  data itself is free to use today.

## Reviewing seasonal timing

`plants_inventory.taxonomy_seasonal_fact` now ships seeded content
(`migrations/1789600000000_seasonal-timing-seed.sql`): fifteen common vegetable taxa with
northern-hemisphere sowing, transplant and harvest windows, extracted from cited public-domain
USDA publications under ADR-0013's extraction lane.

**A seeded row is not usable until a garden accepts it, and that is the control, not an oversight.**
`findAcceptedForGarden` inner-joins `garden_seasonal_fact_acceptance`, so
`seasonal.sowing-window-check`, `succession.replanting-reminder` and
`rotation.crop-rotation-caution` see nothing in a garden whose owner has not accepted the timing.
A migration cannot forge an acceptance — `seasonal-timing-seed.test.ts` asserts the seed writes
none.

**Who may accept.** The garden's own owner or editor, checked with the existing
`editGardenContent` capability; a viewer is refused. There is nothing to configure and no allowlist
to set — this replaced a global `PLANT_REVIEWER_EMAILS` sign-off that could never be operated
because the variable was never passed to the deployed service. See ADR-0013's August 7, 2026
amendment for why the authority is scoped to the garden rather than granted globally.

`PLANT_REVIEWER_EMAILS` still gates the plant-assertion queue above; it no longer has anything to
do with seasonal timing.

**The queue.**

| Operation                       | Route                                                           |
| ------------------------------- | --------------------------------------------------------------- |
| List timing awaiting acceptance | `GET /v1/gardens/{gardenId}/seasonal-facts/awaiting-acceptance` |
| Accept one                      | `POST /v1/gardens/{gardenId}/seasonal-facts/{factId}/accept`    |

Both are authenticated ordinary garden routes; the capability check runs inside the use case. The
queue lists only taxa the garden actually grows, for the garden's own hemisphere — a gardener
decides about the plants in front of them, not a catalogue-wide backlog. `hemisphereKnown: false`
means the garden has no location yet, reported separately so "nothing to decide" and "cannot decide
anything" are not the same empty list.

`accepted_by_profile_id` is always the calling actor — a person can only record themselves as
having accepted, which is what makes the column an accountable claim.

Accepting is the only transition. A fact a garden has not accepted is already unreadable, so
declining is simply not accepting; correcting a bad window is authoring, not accepting. Accepting
twice is one decision recorded once and still answers `accepted`. An unknown id and a fact for the
other hemisphere both answer `notAcceptableHere`, deliberately indistinguishable so a probe cannot
confirm an id exists.

**What to check before signing off a row.** The months are northern-hemisphere and were extracted,
not authored — confirm each window against your own region and practice, and correct rather than
approve anything you would not stand behind. `rotationRestSeasons` drives how long
`crop-rotation-caution` warns against replanting the same family; `successionIntervalDays` drives
how often `succession.replanting-reminder` fires. A `null` means the source did not support a
value, never that none exists.

### Where proposals come from

Two things fill the review queue.

The **seed** (`1789600000000_seasonal-timing-seed.sql`) is fifteen taxa extracted from cited
public-domain USDA publications — ADR-0013's extraction lane, where the model is a parser and the
record's source stays the underlying text.

The **proposal phase** drafts timing for taxa a garden actually grows and nobody has timing for.
It runs at the end of the taxon-enrichment sweep — never during a user request, per ADR-0013 — and
only when the AI switch is on. Adding a plant does not call Vertex; it makes that plant's taxon
eligible for the next pass, which keeps the add-a-plant path free of provider latency, outages and
spend.

Proposals are `authoring_method = 'ai_proposed_reviewed'` with no source citation, because an
accepted proposal becomes this project's own authored content rather than a borrowed source. Every
one lands `awaiting_horticultural_review` and is invisible to the rules until signed off. Demand is
the ordering principle: only taxa with an active plant in an active, georeferenced garden are
proposed for, so the queue's length is a property of what people actually grow rather than of the
catalogue's size.

**What the model may not draft, structurally.** Edibility, toxicity and chemical application are
excluded from AI authoring by ADR-0013, and the response schema has no property that could carry
them. A prompt instruction can drift; an absent schema field cannot.

**Null is a correct answer.** Every timing field is nullable, and a proposal where the model claims
nothing is recorded as a decline rather than as an empty queue entry. A reviewer can correct a null;
a reviewer cannot tell a confident guess from knowledge.

Spend is bounded by the same per-hour and per-day budgets as the explanation capability, with its
own `vertex-ai-seasonal-timing` quota key so drafting spend stays measurable apart from explanation
spend, a per-run cap of ten taxa, and a strict per-call deadline.
