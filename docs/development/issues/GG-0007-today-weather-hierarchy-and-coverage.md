# GG-0007: Today weather periods and missing measurements are difficult to interpret

| Field          | Value        |
| -------------- | ------------ |
| Status         | `closed`     |
| Severity       | `SEV-3`      |
| Surface        | `web / API`  |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-10-05` |

## Summary

The Today weather panel did not establish a clear hierarchy among the latest point observation,
nearest forecast point, interval precipitation, and completed-day rainfall. A deployed forecast
could also resolve to a rain-only daily record, leaving temperature, wind, and humidity absent.
Web 0.6.4 clarifies every time window and preserves unavailable-versus-zero semantics.

## Observations

| Observation   | Date       | Surface and version                            | Expected                                                                                                                                                                                   | Actual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Reproducibility                                                                                                                                                                                                               |
| ------------- | ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OBS-R02-007   | 2026-10-04 | Web 0.6.4, deployed development; Chrome, macOS | Distinct measured/forecast periods, explicit zero versus unavailable values, interval semantics, completed-day coverage, separate impact text, and persistent localized temperature units. | Passed for observed states: current 20.9 Celsius/0 mm and a distinct upcoming 0.8 mm rain-only forecast with unavailable temperature/wind/humidity; separate effective/retrieval times; latest interval explicitly not a whole-day total; six of seven completed days and 0.1 mm measured total; separate impact section. Fahrenheit displayed 69.6 and survived reload; Celsius was restored. English and Russian labels were checked. A new unlocated garden showed no weather, unavailable interval, and no measured rainfall without inventing zero. Stale-reading and complete four-measurement forecast states were not available for manual verification. | Existing garden plus disposable unlocated garden; unit persistence reproduced by reload.                                                                                                                                      |
| OBS-CLOSE-007 | 2026-10-05 | Web 0.6.4, deployed development; Chrome, macOS | A complete forecast remains separate from measured conditions, with all four measurements and localized period labels.                                                                     | Passed: current 9.9 Celsius, 0 mm, 3.09 m/s, 63% humidity and the upcoming 9.8 Celsius, 0 mm, 3.05 m/s, 65% humidity appeared in separate cards with distinct effective times and a shared retrieval time. English and Russian labels were verified. Stale readings were not present.                                                                                                                                                                                                                                                                                                                                                                            | Observed from the live stored provider results; repeated after changing language and restoring English.                                                                                                                       |
| OBS-STALE-007 | 2026-10-05 | Web 0.6.4, deployed development; Chrome, macOS | Stale current and forecast readings retain their values, show a localized stale label, and explain their lower confidence.                                                                 | Passed with an explicitly synthetic local response override: current 12.3 Celsius and forecast 11.5 Celsius each showed the English and Russian Out of date labels, separate effective and retrieval times, all four measurements, and the lower-confidence explanation.                                                                                                                                                                                                                                                                                                                                                                                         | Temporary override in the disposable R02 garden only; English and Russian checked, English restored, overrides disabled and configuration cleared, then the ordinary server response returned No weather for this garden yet. |

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

## R02 manual verification result

Keep this issue open (`fixed`). Observed current, partial forecast, zero, missing
interval, rainfall coverage, impact, localization and unit persistence behavior
passed. Deployed stale readings and a full temperature/wind/humidity forecast
were not observed; the previous automated coverage cannot replace the requested
manual acceptance evidence. The remaining states must be checked before closure.
No provider refresh, production data mutation, issue-specific Playwright assertion,
or GG-0007 fix was introduced by R02 (DEC-003).

## Follow-up verification and closure on 2026-10-05

The live development data includes a complete four-measurement forecast. The
dated observation above passes that remaining state in English and Russian.
The stale state was verified manually on the deployed UI with a temporary local
DevTools response override, explicitly labelled as synthetic. This is UI fixture
evidence, not evidence that the live provider returned stale data or that the
rule engine processed the fixture. No stored provider data was changed.

Both stale cards retained their measurements, separate period labels, and
localized lower-confidence explanation. After checking English and Russian,
English was restored, local overrides were disabled, the folder configuration
was cleared, and reloading returned the garden's ordinary unavailable response.
Together with OBS-R02-007 and OBS-CLOSE-007, this completes the issue's UI
acceptance and closes GG-0007. The original R02 result above remains historical.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: none

## History

| Date       | Change                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-31 | Observation analyzed and weather hierarchy fixed in web 0.6.4.                                                                     |
| 2026-10-04 | R02 deployed manual verification recorded; issue remained open pending complete passing acceptance.                                |
| 2026-10-05 | Complete live forecast and temporary stale UI fixture passed on deployed development; ordinary response restored and issue closed. |
