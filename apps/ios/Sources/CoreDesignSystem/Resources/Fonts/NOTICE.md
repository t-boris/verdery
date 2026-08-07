# Bundled typefaces

Field Console sets text in **IBM Plex Sans** and machine-oriented labels,
counts and measured values in **IBM Plex Mono** — one superfamily, so the two
faces share a skeleton rather than merely coexisting.

| Family        | Files                                                | Copyright                            | Licence                     |
| ------------- | ---------------------------------------------------- | ------------------------------------ | --------------------------- |
| IBM Plex Sans | `IBMPlexSans-{Regular,Medium,SemiBold,Bold}.ttf`     | IBM Corp., Reserved Font Name "Plex" | SIL OFL 1.1 — `OFL-IBMPlex.txt` |
| IBM Plex Mono | `IBMPlexMono-{Regular,Medium,SemiBold}.ttf`          | IBM Corp., Reserved Font Name "Plex" | SIL OFL 1.1 — `OFL-IBMPlex.txt` |

The licence permits redistribution inside a product so long as the licence text
travels with the font, which is why `OFL-IBMPlex.txt` sits beside the binaries,
is copied into the application bundle by `.process("Resources")`, and must not
be deleted. Both families are the same IBM Plex licence, so one file covers all
seven faces.

**These files are unmodified.** That is a licence requirement here, not a
preference: IBM Plex carries the Reserved Font Name "Plex", so a modified
build — including one produced by instancing a variable font — could not keep
the family name. The statics therefore come from IBM's own release
(`IBM/plex`, `@ibm/plex-sans@1.1.0`) and from Google Fonts' `ofl/ibmplexmono`,
both shipped as authored.

## Why not Archivo, which the web uses

`apps/web/shared/ui/tokens.css` sets `--font-family-sans` to Archivo, and the
original intent was to carry the same face here. Archivo has **no Cyrillic**:
not in the Omnibus-Type upstream statics, and not in the Google Fonts variable
build either — both cover 653 glyphs and none of them is a Russian letter.

That is survivable on the web, which ships deliberate Latin-only subsets and
lets Cyrillic fall through to the system stack (see
`apps/web/shared/ui/fonts/NOTICE.md`). It is not survivable here. Russian is a
first-class language in this application — 895 keys, with
`Tests/CoreLocalizationTests` failing the build on any parity gap — so with
Archivo every Russian screen would render in the system face, and a mixed
string like "Verdery · Мой сад" would change typeface mid-line.

IBM Plex Sans covers Cyrillic completely in all four shipped weights, and it
was already the right neighbour: Plex Mono was chosen for the label and status
role before this question came up.

Note that `apps/web/shared/ui/fonts/NOTICE.md` states that adding Cyrillic is
"another two files and two `@font-face` blocks". That is true of IBM Plex Mono
and **false of Archivo**, where no Cyrillic subset exists to add.

## PostScript names are not derivable from the file names

The name a font is requested by at runtime is its PostScript name, and IBM Plex
Sans abbreviates two of them. Asking for a name that does not exist does not
raise — CoreText silently substitutes the system font — so these strings are
pinned in `Typography/FontFace.swift` and asserted by
`Tests/CoreDesignSystemTests/FontRegistrationTests.swift`, which registers the
real files and fails if any face resolves to something else.

| File                        | PostScript name       |
| --------------------------- | --------------------- |
| `IBMPlexSans-Regular.ttf`   | `IBMPlexSans`         |
| `IBMPlexSans-Medium.ttf`    | `IBMPlexSans-Medm`    |
| `IBMPlexSans-SemiBold.ttf`  | `IBMPlexSans-SmBld`   |
| `IBMPlexSans-Bold.ttf`      | `IBMPlexSans-Bold`    |
| `IBMPlexMono-Regular.ttf`   | `IBMPlexMono-Regular` |
| `IBMPlexMono-Medium.ttf`    | `IBMPlexMono-Medium`  |
| `IBMPlexMono-SemiBold.ttf`  | `IBMPlexMono-SemiBold`|

## Why static faces rather than one variable file

Both families have variable builds, and one file per family would be smaller.
`Font.custom(_:size:relativeTo:)` addresses a face by PostScript name, and a
variable font's named instances are not dependable that way across the
deployment range — a weight that fails to resolve degrades silently to the
default instance, which is the same invisible failure as a wrong name. Seven
static faces at 1.2 MB is a small price for four weights that are certain.
