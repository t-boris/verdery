# GG-0001: Sign-in composition obscures its image and lacks responsive visual coverage

| Field          | Value        |
| -------------- | ------------ |
| Status         | `analyzed`   |
| Severity       | `SEV-4`      |
| Surface        | `web`        |
| Code finding   | `supported`  |
| First reported | `2026-08-31` |
| Last updated   | `2026-08-31` |

## Summary

The Russian sign-in screen was reported as visually poor. The overall aesthetic judgment is
subjective, but the supplied view matches a code-defined composition with concrete weaknesses: the
form covers the source image's only strong visual area, the page is forced into a uniformly dark
presentation, and the heading has little scale contrast with the dense card contents. The sign-in
route also has no genuine multi-viewport regression coverage, so these choices are not evaluated at
the web product's supported phone, tablet, and desktop widths.

## Observations

| Observation | Date       | Surface and version                      | Expected                                     | Actual                                                                                                                                  | Reproducibility |
| ----------- | ---------- | ---------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| OBS-001     | 2026-08-31 | Web 0.6.1, deployed development, Russian | A clear, balanced, welcoming sign-in screen. | Dark full-viewport image treatment with the form card in the right half, a small brand header, and an overall visually poor impression. | always          |

The observation contains a qualitative design assessment, not an accessibility failure report.

## Code analysis

### Finding

The reported layout is supported by the code. Whether it is “awful” remains design judgment, but
the following implementation facts explain that judgment:

1. `page.module.css` uses `justify-content: flex-end` and caps the card at `28rem`, deliberately
   placing the entire task on the right of a large hero region.
2. The 1800×600 `field-console-botanical.webp` asset is darkest and emptiest on the left and carries
   its foliage detail on the right. The right-aligned card covers that detail, while a gradient
   reaches 88% canvas colour over the same area. The result spends most of the page on a dark,
   low-information field and suppresses the image's focal content.
3. The root layout hard-codes `data-theme="dark"`. The sign-in route has no local theme or tonal
   alternative, and its card is a 91% dark surface over the darkened image. This supports the
   reported monotony, but does **not** establish a WCAG contrast failure.
4. The sign-in heading is explicitly reduced to `--font-size-xl` (1.25rem), overriding the global
   1.5rem `h1`. It competes with a decorative leaf mark, description, two provider buttons, a
   divider, a field, and a primary button inside one compact column. Calling the hierarchy weak is
   a design judgment supported by those relative sizes and density.
5. Responsive behavior has only one sign-in-specific breakpoint at 30rem. It abruptly changes from
   centered full-height composition to top-aligned intrinsic height and shifts the image to 72%;
   there is no sign-in-specific tablet treatment.
6. `responsive.spec.ts` explicitly documents that its authenticated visit to `/auth/sign-in`
   redirects to the garden list. Its phone/tablet/desktop loop therefore does not render the
   sign-in page. The separate accessibility form-error test renders sign-in, but does not assess
   layout across viewports or visual composition.

Russian copy is complete and the actions use full-width controls, so the inspected code does not
support a missing-translation or truncation defect. The small uppercase monospaced tagline is an
intentional global shell treatment; whether it is appropriate on an acquisition/sign-in surface is
part of the same hierarchy judgment, not a separate localization bug.

### Evidence

- `apps/web/app/auth/sign-in/page.module.css` — right alignment, fixed card maximum, dark image
  overlays, heading size, and the single 30rem breakpoint.
- `apps/web/public/images/field-console-botanical.webp` — 1800×600 source image whose foliage is
  concentrated on the right.
- `apps/web/app/layout.tsx` — unconditional `data-theme="dark"` and the global header rendered above
  sign-in.
- `apps/web/app/layout.module.css` — compact header/tagline hierarchy and the separate 40rem header
  breakpoint.
- `apps/web/app/auth/sign-in/sign-in-panel.module.css` — one dense column of full-width actions.
- `apps/web/shared/localization/messages/ru.ts` — complete Russian title, description, provider,
  divider, email-field, and email-action copy.
- `apps/web/e2e/responsive.spec.ts` — explicit admission that responsive checks do not render the
  sign-in route because the test is authenticated.
- `apps/web/e2e/accessibility.spec.ts` and `apps/web/shared/ui/tokens.css` — accessibility and token
  contrast checks; these prevent treating a dark aesthetic alone as a verified contrast failure.

### Affected surface

- `/auth/sign-in` in Russian and English.
- Desktop composition directly; phone and tablet composition remain insufficiently verified.
- First-time access, expired-session recovery, invitation sign-in, and any protected-route redirect
  that lands on the shared sign-in page.

### Likely cause

Verified facts point to one common cause rather than several independent defects: a bespoke
“field-console hero” composition was applied to an authentication task without preserving the
image's focal area or adding route-specific visual regression coverage. The implementation is
internally consistent; its design direction and validation criteria are the problem.

## Reproduction and validation

1. Open `https://dev.verdery-app.com/auth/sign-in` in a signed-out browser.
2. Select Russian and inspect 360×780, 834×1112, and 1440×900 viewports.
3. Compare the card position with the source image's foliage and assess heading/action hierarchy.
4. After a redesign, add unauthenticated sign-in coverage at all three supported viewports. Keep
   axe, keyboard, focus, reflow, and control-target checks, and add stable visual snapshots or
   explicit composition assertions for this route.

## Resolution

Pending. A fix should treat the card/image composition, authentication-specific shell hierarchy,
and responsive coverage as one design pass. No application change was made during triage.

## Relationships

- Duplicate of: none
- Consolidates: none
- Split from: none
- Related issues: none

## History

| Date       | Change                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| 2026-08-31 | OBS-001 recorded and analyzed against the deployed sign-in implementation and test suite. |
