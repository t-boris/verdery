import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * WCAG contrast, measured against the palette in `tokens.css` itself.
 *
 * The E2E axe pass (`e2e/accessibility.spec.ts`) checks text contrast on the
 * real rendered pages, which is the stronger evidence — but it can only check
 * colour pairs that some page actually puts on screen at the moment it runs,
 * and axe implements no automated rule for SC 1.4.11 (Non-text Contrast) at
 * all. This suite closes both gaps: it reads the token values out of the
 * stylesheet and asserts every pairing the design system permits, in both
 * palettes, including the control boundaries axe cannot see.
 *
 * Parsing the CSS rather than duplicating the hex values is the point — a
 * palette edit that drops a pair below its threshold fails here, which a
 * hard-coded copy of the palette would not.
 *
 * Source: architecture/web-application-design.md, section "14. Accessibility";
 * technical-specification.md, section 11 ("Accessibility requirements must be
 * defined and tested before release").
 */

// `import.meta.url` is rewritten to an `http:` URL under the jsdom
// environment, so the stylesheet is located from the Vitest root (this
// package) instead.
const TOKENS_CSS = readFileSync(join(process.cwd(), 'shared/ui/tokens.css'), 'utf8');

/** WCAG 2.2 SC 1.4.3: normal-size body text. */
const AA_TEXT = 4.5;
/** WCAG 2.2 SC 1.4.3: text at 24px, or 18.66px bold, and above. */
const AA_LARGE_TEXT = 3;
/** WCAG 2.2 SC 1.4.11: the visual boundary of a control, and meaningful graphics. */
const AA_NON_TEXT = 3;

type Palette = Readonly<Record<string, string>>;

/**
 * Reads one declaration block's custom properties.
 *
 * The light palette is the `:root {` block; the dark one is read from the
 * explicit `:root[data-theme='dark']` block, which `tokens.css` keeps
 * byte-identical to the `prefers-color-scheme` block above it (asserted
 * below, so the two can never drift apart unnoticed).
 */
function readBlock(selector: string): Palette {
  const start = TOKENS_CSS.indexOf(`${selector} {`);
  expect(start, `tokens.css has no "${selector}" block`).toBeGreaterThanOrEqual(0);

  const open = TOKENS_CSS.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let index = open; index < TOKENS_CSS.length; index += 1) {
    if (TOKENS_CSS[index] === '{') depth += 1;
    if (TOKENS_CSS[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  const body = TOKENS_CSS.slice(open + 1, end);
  const palette: Record<string, string> = {};
  for (const match of body.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6})\s*;/gu)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) {
      palette[name] = value;
    }
  }
  return palette;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Every surface a token-coloured element is ever painted on. */
const SURFACES = ['--color-canvas', '--color-surface', '--color-surface-sunken'] as const;

/** Foreground, background, and the threshold the pair must clear. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  // Body and secondary copy on every surface.
  ...SURFACES.flatMap(
    (surface) =>
      [
        ['--color-text', surface, AA_TEXT],
        ['--color-text-muted', surface, AA_TEXT],
        ['--color-accent', surface, AA_TEXT],
        ['--color-positive', surface, AA_TEXT],
        ['--color-negative', surface, AA_TEXT],
        ['--color-warning', surface, AA_TEXT],
        // A control's boundary is the only thing identifying it as a control.
        ['--color-control-border', surface, AA_NON_TEXT],
        // The focus ring must be visible wherever focus can land.
        ['--color-focus', surface, AA_NON_TEXT],
      ] as const,
  ),

  // Text on a filled control.
  ['--color-accent-text', '--color-accent', AA_TEXT],
  ['--color-accent-text', '--color-accent-hover', AA_TEXT],
  ['--color-accent-text', '--color-accent-active', AA_LARGE_TEXT],

  // Text on the quiet tone washes (alerts, pills, the active navigation tab).
  ['--color-text', '--color-accent-quiet', AA_TEXT],
  ['--color-text-muted', '--color-accent-quiet', AA_TEXT],
  ['--color-accent', '--color-accent-quiet', AA_TEXT],
  ['--color-text', '--color-negative-quiet', AA_TEXT],
  ['--color-negative', '--color-negative-quiet', AA_TEXT],
  ['--color-text', '--color-warning-quiet', AA_TEXT],
  ['--color-warning', '--color-warning-quiet', AA_TEXT],
];

describe.each([
  ['light', ':root'],
  ['dark', ":root[data-theme='dark']"],
])('%s palette', (_name, selector) => {
  const palette = readBlock(selector);

  it.each(PAIRS)('%s on %s clears %s:1', (foreground, background, threshold) => {
    const foregroundValue = palette[foreground] ?? readBlock(':root')[foreground];
    const backgroundValue = palette[background] ?? readBlock(':root')[background];

    expect(foregroundValue, `${foreground} is not defined`).toBeDefined();
    expect(backgroundValue, `${background} is not defined`).toBeDefined();

    const ratio = contrastRatio(foregroundValue as string, backgroundValue as string);
    expect(
      Number(ratio.toFixed(2)),
      `${foreground} on ${background} is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(threshold);
  });
});

describe('palette definition', () => {
  it('keeps the media-query dark palette identical to the data-theme one', () => {
    const explicit = readBlock(":root[data-theme='dark']");
    const preferred = readBlock(":root:not([data-theme='light'])");

    expect(preferred).toEqual(explicit);
  });

  it('defines a control boundary distinct from the decorative hairline', () => {
    const light = readBlock(':root');

    // `--color-border` is deliberately below the 3:1 control threshold; the
    // point of the separate token is that a control never reaches for it.
    expect(
      contrastRatio(light['--color-border'] as string, light['--color-surface'] as string),
    ).toBeLessThan(AA_NON_TEXT);
    expect(light['--color-control-border']).not.toBe(light['--color-border']);
  });
});
