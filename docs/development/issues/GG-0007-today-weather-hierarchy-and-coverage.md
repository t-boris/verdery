# GG-0007: Today weather periods and missing measurements are difficult to interpret

| Field          | Value        |
| -------------- | ------------ |
| Status         | `fixed`      |
| Severity       | `SEV-3`      |
| Surface        | `web / API`  |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-08-31` |

## Summary

The Today weather panel did not establish a clear hierarchy among the latest point observation,
nearest forecast point, interval precipitation, and completed-day rainfall. A deployed forecast
could also resolve to a rain-only daily record, leaving temperature, wind, and humidity absent.
Web 0.6.4 clarifies every time window and preserves unavailable-versus-zero semantics.

## Code analysis

### Finding

Supported. Stored provider batches contain current point conditions, one nearest hourly forecast,
and daily precipitation totals. Selecting records by insertion/retrieval order could choose a
rain-only daily row instead of the point reading. The current repository code now selects the most
recent effective observation and nearest upcoming forecast, while the Open-Meteo adapter requests
all four hourly forecast measurements.

The domain does not expose a verified partial current-day accumulation. Current precipitation is a
provider interval, while the seven-day series contains completed daily totals. The UI must not add
partial and forecast periods or call the latest interval a whole-day total.

## Resolution

Fixed in web 0.6.4:

- Current conditions and Next forecast are distinct cards with their effective and retrieval times.
- Each card explains its point-in-time window and labels stale readings without hiding them.
- Temperature, precipitation, wind, and humidity use consistent visual icons and accessible text.
- Missing values say they are unavailable in the stored reading; measured zero precipitation stays
  `0 mm`.
- Today's precipitation shows the latest provider interval and explicitly says it is not a daily
  total. A missing interval gets a separate unavailable state.
- The seven-day chart is labelled as completed-day precipitation and reports coverage, so three
  measured days are not presented as seven complete days.
- The recommendation-impact explanation is a visually separate section.
- A localized °C/°F switch applies to current and forecast temperatures. It preserves provider
  values in Celsius, stores only the display preference in the
  `verdery_temperature_unit` first-party cookie for one year, and restores the cookie on the server
  before rendering to avoid a unit hydration mismatch.

Verified coverage includes complete and partial readings, zero versus unavailable precipitation,
stale data, a bare calendar day at a year/timezone boundary, conversion, cookie persistence and
restore, provider nearest-hour mapping, and rainfall deduplication.

## Limitations

- Provider requests and stored daily periods currently use UTC. The panel therefore does not claim
  a garden-local current-day total; doing so requires preserving a garden/provider timezone in the
  weather model.
- The panel reads stored sweep results and cannot trigger a provider refresh. Missing provider data
  remains missing until a later sweep supplies it.
- Open-Meteo supplies no confidence score. Freshness comes from retrieval time, not an invented
  confidence value.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: none

## History

| Date       | Change                                                         |
| ---------- | -------------------------------------------------------------- |
| 2026-08-31 | Observation analyzed and weather hierarchy fixed in web 0.6.4. |
