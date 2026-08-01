# Self-hosted webfonts

Both families ship from this directory rather than a font CDN, because the
Content Security Policy allows no remote font origin — see
`e2e/content-security-policy.spec.ts`, which fails if one is introduced.

| Family        | Files                                     | Copyright                            | Licence                             |
| ------------- | ----------------------------------------- | ------------------------------------ | ----------------------------------- |
| Archivo       | `archivo-variable-latin.woff2`            | The Archivo Project Authors          | SIL OFL 1.1 — `OFL-Archivo.txt`     |
| IBM Plex Mono | `ibm-plex-mono-{400,500,600}-latin.woff2` | IBM Corp., Reserved Font Name "Plex" | SIL OFL 1.1 — `OFL-IBMPlexMono.txt` |

Both licences permit redistribution, including bundled inside a product, so
long as the licence text travels with the font — which is why the two `OFL-*.txt`
files sit beside the binaries and must not be deleted.

## Why these exact files

They are the `latin` subsets Google Fonts serves (`U+0000-00FF` plus the usual
punctuation ranges), not the full families: 72 KB for all four against roughly a
megabyte for the complete character sets. The product's UI copy is English and
Russian — and Russian is deliberately NOT covered here. Cyrillic falls through to
the next family in each stack (the system sans / system mono), which is correct
for now and cheap to revisit: adding `-cyrillic` subsets is another two files and
two `@font-face` blocks in `fonts.css`, no token or component change.

Archivo is a variable font covering weight 400-700 in one file, so the four
`--font-weight-*` tokens all resolve from a single request. IBM Plex Mono has no
variable build on Google Fonts, hence three static weights.

Source: templates/kern-grid/IMPLEMENTATION.md, section 1 ("Type").
