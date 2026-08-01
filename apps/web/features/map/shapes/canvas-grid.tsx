'use client';

import { Line } from 'react-konva';

import type { CanvasSize } from '../types';

/** The direction's grid pitch, in SCREEN pixels — see the component's own note on why it is not metres. */
const GRID_PITCH_PIXELS = 40;

export interface CanvasGridProps {
  readonly size: CanvasSize;
  /** Hairline colour, resolved from `--color-border` by the caller — Konva paints to a canvas and cannot read a CSS custom property itself. */
  readonly stroke: string;
}

/**
 * Kern's 40px hairline grid, painted under everything else on the stage.
 *
 * SCREEN pixels, not garden metres, and deliberately so. A metric grid would
 * have to redraw at a different density on every zoom step and would read as
 * a measurement overlay — implying exactly the survey accuracy the status
 * bar's disclosure denies. This grid is chrome: it gives the canvas a visible
 * ground so an empty garden is not a blank rectangle, and it stays a constant
 * 40px whatever the camera does. `MapScaleBadge` remains the only thing on
 * screen that states a real distance.
 *
 * `listening={false}` on every line keeps the grid out of Konva's hit graph,
 * so it costs nothing on pointer events and can never intercept a click meant
 * for a shape beneath the cursor.
 *
 * Source: templates/kern-grid/IMPLEMENTATION.md, section 3 ("Canvas").
 */
export function CanvasGrid({ size, stroke }: CanvasGridProps) {
  const columns = Math.ceil(size.width / GRID_PITCH_PIXELS);
  const rows = Math.ceil(size.height / GRID_PITCH_PIXELS);

  return (
    <>
      {Array.from({ length: columns + 1 }, (_, index) => {
        const x = index * GRID_PITCH_PIXELS + 0.5;
        return (
          <Line
            key={`grid-column-${String(index)}`}
            points={[x, 0, x, size.height]}
            stroke={stroke}
            strokeWidth={1}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
      {Array.from({ length: rows + 1 }, (_, index) => {
        const y = index * GRID_PITCH_PIXELS + 0.5;
        return (
          <Line
            key={`grid-row-${String(index)}`}
            points={[0, y, size.width, y]}
            stroke={stroke}
            strokeWidth={1}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
    </>
  );
}
