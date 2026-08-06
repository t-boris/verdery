import type Konva from 'konva';
import { describe, expect, it, vi } from 'vitest';

import { isStagePanTarget } from './stage-drag';

describe('isStagePanTarget', () => {
  it('accepts only the stage itself, not a bubbled object drag', () => {
    const getStage = vi.fn<() => Konva.Stage | null>();
    const stage = { getStage } as unknown as Konva.Stage;
    getStage.mockReturnValue(stage);
    const object = { getStage: () => stage } as unknown as Konva.Node;

    expect(isStagePanTarget(stage)).toBe(true);
    expect(isStagePanTarget(object)).toBe(false);
  });
});
