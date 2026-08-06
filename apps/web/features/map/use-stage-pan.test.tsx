import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useStagePan } from './use-stage-pan';

describe('useStagePan', () => {
  it('moves the real camera continuously instead of waiting to jump on drag end', () => {
    const onCameraChange = vi.fn();
    const camera = { centerX: 10, centerY: 20, scale: 10, rotationDegrees: 0 };
    const pointer = { x: 100, y: 100 };
    const stage = {
      getStage: () => stage,
      getPointerPosition: () => ({ ...pointer }),
    };
    const event = { target: stage };
    const { result } = renderHook(() => useStagePan({ enabled: true, camera, onCameraChange }));

    act(() => result.current.start(event as never));
    pointer.x = 130;
    pointer.y = 80;
    act(() => {
      result.current.move(event as never);
    });

    expect(onCameraChange).toHaveBeenCalledWith({
      centerX: 7,
      centerY: 18,
      scale: 10,
      rotationDegrees: 0,
    });
    expect(result.current.consumeClick()).toBe(true);
  });
});
