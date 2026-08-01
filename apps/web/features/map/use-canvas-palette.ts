'use client';

import { useEffect, useState } from 'react';

export interface CanvasPalette {
  /** `--color-border` — the grid hairline. */
  readonly grid: string;
  /** `--color-text` — the label chip's ink fill. */
  readonly chipFill: string;
  /** `--color-canvas` — the chip's own text, reading out of the ink. */
  readonly chipText: string;
}

/** Pre-paint values matching the light palette, so the first frame is never black-on-black. */
const FALLBACK: CanvasPalette = { grid: '#d3d1c4', chipFill: '#15150f', chipText: '#f2f0e9' };

function read(): CanvasPalette {
  if (typeof document === 'undefined') {
    return FALLBACK;
  }
  const computed = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string): string => {
    const resolved = computed.getPropertyValue(name).trim();
    return resolved === '' ? fallback : resolved;
  };
  return {
    grid: value('--color-border', FALLBACK.grid),
    chipFill: value('--color-text', FALLBACK.chipFill),
    chipText: value('--color-canvas', FALLBACK.chipText),
  };
}

/**
 * The handful of token colours the Konva stage needs as literal strings.
 *
 * Konva paints to a `<canvas>`, so it cannot resolve `var(--color-border)` —
 * every colour reaching it must already be a concrete value. `category-style.ts`
 * sidesteps this by hard-coding category hues, which is fine for those (they
 * are deliberately the same in both palettes) but wrong for chrome: a grid in
 * the light palette's hairline colour is invisible on the dark canvas.
 *
 * Re-reads when the OS colour-scheme preference flips and when `data-theme`
 * changes on the root element, which are the only two ways this application's
 * palette can change (`shared/ui/tokens.css`).
 */
export function useCanvasPalette(): CanvasPalette {
  const [palette, setPalette] = useState<CanvasPalette>(FALLBACK);

  useEffect(() => {
    const refresh = () => setPalette(read());
    refresh();

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      media.removeEventListener('change', refresh);
      observer.disconnect();
    };
  }, []);

  return palette;
}
