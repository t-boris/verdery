# Lessons

Patterns extracted from owner feedback, so the same mistake is not repeated.

## 2026-07-25 — "выглядит очень примитивно" (deployed web app)

**What happened**: Seven phases shipped web features with bare-bones styling and no
deliberate design pass. The first time the owner opened the deployed product, the
functional depth was invisible behind a primitive-looking surface.

**Rules for next time**:

- Function-complete is not ship-complete. Schedule an explicit visual design pass
  before anything is presented as "deployed and visible" — the first impression of a
  deployed URL is visual, not architectural.
- Build the design system (tokens, component states, chrome, empty/loading states)
  alongside the first UI work package, not after phase seven. Retrofitting is cheap
  only if components already draw every value from tokens.
- When restyling an existing suite-covered UI: keep roles, accessible names, and
  visible copy stable; restructure markup freely underneath. This pass changed the
  entire look, moved navigation into the shell, and required zero test-assertion
  changes because every selector was role/label/text-based — preserve that property
  in future tests too (no class-based selectors).
- Navigation chrome must never use list markup (`<ul>/<li>`): end-to-end assertions
  count `listitem` roles on pages, and chrome must not leak into content queries.

## 2026-08-01 — invented a work-package identifier (self-caught, post-push)

**What happened**: The candidate-photo feature was written with `Source:
implementation-plan.md work package P11-CAND-PHOTO-01` in 13 places, including two
operation descriptions in the OpenAPI contract. No such work package exists —
it was invented to label the increment. Caught only during the docs-sync check
after the commit was already pushed, requiring a second corrective commit.

**Rules for next time**:

- This repository's comments carry `Source: implementation-plan.md work package X`
  as a load-bearing convention. Never write one of those lines without first
  confirming `X` is a real row: `grep -c "| X " docs/implementation-plan.md`.
- New work usually belongs to an EXISTING package whose stated scope already
  covers it — read the package's scope text before concluding otherwise. Here the
  scope was already covered by P11-API-01 ("candidate ... media-association ...
  APIs") and P11-WEB-01 ("catalog/add/unknown flows").
- Adding a row to the plan of record is a bigger, owner-facing decision than
  labelling work under a package that already covers it. Prefer the latter; raise
  the former rather than doing it silently.
- Run the docs-sync obligation (repository rule: keep `docs/` accurate and
  synchronized in the SAME task) BEFORE committing, not after pushing.
