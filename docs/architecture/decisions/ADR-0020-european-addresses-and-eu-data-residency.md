# ADR-0020: European Addresses Now, EU Data Residency Not Yet

> Status: Proposed — the residency half needs the owner's decision
> Date: August 8, 2026

## Context

The owner searched for a European address and found nothing. The cause is structural rather than a
defect: address search went through the **United States Census Bureau geocoder**, a US federal
service whose only coverage is US addresses. No parameter changes that. The interface said so —
"United States addresses only, for now" — which made the behaviour honest without making it useful.

That geocoder was chosen deliberately on 2026-08-04, and `us-census-geocoding-adapter.ts` recorded
why: free, no key, public-domain data, and — in as many words — "unlike Nominatim it carries neither
ODbL share-alike nor a usage policy this product would outgrow". The reasoning was sound while the
United States was the only market ([ADR-0007](ADR-0007-us-central1-production-baseline.md)).

Wanting Europe is not one change. Five things are bound to the first market, and they are not bound
equally:

| Concern                   | State outside the United States                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Address search            | No results at all — the geocoder has no data                                                                                |
| Aerial imagery, iOS       | **Already works.** The backdrop is MapKit, which is global                                                                  |
| Aerial imagery, web       | Empty. NAIP is USGS imagery, United States only, and the editor says so                                                     |
| Weather                   | **Already works.** Open-Meteo is global                                                                                     |
| Hardiness zones           | `hardinessZone` is `null` on every market today; the planned source is a USDA raster, which does not apply in Europe        |
| Where personal data lives | `us-central1`, and ADR-0007 says expansion into regulated non-US markets "requires a new residency and regionalization ADR" |

## Decision

**Two decisions, deliberately separated, because one is an engineering choice and the other is a
legal obligation.**

### 1. Accepted: Nominatim replaces the US Census geocoder

Address search becomes worldwide through Nominatim (OpenStreetMap), behind the existing
provider-neutral `AddressGeocodingAdapter` port. The two objections the previous decision raised are
answered rather than waved away:

- **ODbL share-alike** binds whoever redistributes or derives a database. This port stores nothing
  from the provider: a candidate is shown, a person picks one, and what persists is the anchor they
  accepted — their own confirmation, not a copy of anyone's database. Attribution is still owed and
  is now displayed wherever candidates are, in both clients and both languages.
- **The usage policy is real** — one request per second, an identifying `User-Agent`, no bulk
  geocoding — and is enforced in the adapter rather than hoped for: requests are serialised through
  a single chain with a minimum interval, and the adapter refuses to be constructed without a
  `User-Agent`, so a build that forgets one fails at composition instead of in front of a user.

"A usage policy this product would outgrow" remains true and remains the exit condition. This
adapter is sized for one person typing one address when they create a garden. A product doing many
searches per second needs a paid provider or a self-hosted Nominatim, and the port is the seam that
makes that a one-file change.

### 2. NOT decided here: where the personal data of EU residents lives

**No European launch follows from this ADR.** A garden's address, its aerial photographs, its
location and its owner's identity are personal data, and for a resident of the EU that engages the
GDPR — including its rules on transfers to the United States. ADR-0007 already anticipated exactly
this and required a separate decision, which this document does not make.

Making it means choosing between at least these, and none is free:

1. **Do nothing and do not launch in the EU.** Address search works worldwide, which serves the
   owner's own testing and anyone who chooses to use a US-hosted service knowingly. No new
   obligation. This is the state after this ADR.
2. **A European region for European gardens.** A second `europe-*` deployment with its own
   database, media buckets and processing. The strongest position, and the most expensive: two
   production estates, a routing decision at sign-up, and a synchronization story that must not
   let a garden move between them by accident.
3. **Split storage: EU personal data in Europe, the rest where it is.** Cheaper than a second
   estate and harder to reason about — the boundary has to be drawn through media, backups, logs
   and every provider, and a boundary nobody can state precisely is one that leaks.
4. **Stay in `us-central1` under transfer safeguards.** Standard Contractual Clauses, a transfer
   impact assessment, and a data processing agreement with every subprocessor
   (Google Cloud, Firebase, Open-Meteo, Nominatim, Vertex AI, Resend). Legal work rather than
   engineering work, and it does not survive first contact with a customer who requires residency.

Each also drags in the things a launch needs beyond storage: a privacy notice in the local
language, a lawful basis for each processing purpose, subject-access and erasure paths that already
exist here but have never been tested against an EU request, and cookie/consent behaviour on the
web.

## Consequences

- A European address can be found, and on iOS — where the backdrop is MapKit — a European garden can
  be located and traced today.
- The web has no aerial imagery outside the United States. A European user of the web editor can
  place a garden and draw it by hand, and the editor says why there is no photograph rather than
  showing a grey field.
- Attribution to OpenStreetMap is now an obligation this product carries. Removing the hint text
  removes the licence.
- Hardiness remains `null` everywhere. When it is built, it needs a model that is not USDA zones, or
  it will be wrong for Europe in a way that reads as authoritative.
- **Nothing here permits marketing or onboarding EU residents.** Until the residency question above
  is answered, a European garden is the owner's own to test with.

## Alternatives considered

- **Keep the Census geocoder and add a second one for non-US queries.** Two providers, a routing
  rule that has to guess which one a half-typed query belongs to, and two licences. Rejected: one
  global provider is simpler and the port exists to make the choice reversible.
- **A paid geocoder (Mapbox, Google) now.** Better coverage, an SLA, and a bill. Rejected for now
  because nothing measured says the free tier is insufficient, and because the storage terms of
  each would have to be reconciled with this port's "store nothing" rule. Reconsider when the usage
  policy above becomes the binding constraint.
