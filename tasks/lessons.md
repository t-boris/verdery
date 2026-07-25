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
