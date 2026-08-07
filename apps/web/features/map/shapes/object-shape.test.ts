import { describe, expect, it, vi } from 'vitest';

import type { MapCamera } from '../types';
import { commitObjectDrag } from './object-shape';

const CAMERA: MapCamera = {
  centerX: 0,
  centerY: 0,
  scale: 10,
  rotationDegrees: 0,
};

function dragNode(x: number, y: number) {
  const position = vi.fn();
  const batchDraw = vi.fn();
  return {
    node: {
      x: () => x,
      y: () => y,
      position,
      getLayer: () => ({ batchDraw }),
    },
    position,
    batchDraw,
  };
}

describe('commitObjectDrag', () => {
  it('commits one local translation and clears the temporary screen offset after success', async () => {
    const { node, position, batchDraw } = dragNode(20, 30);
    const onMoveEnd = vi.fn().mockResolvedValue(undefined);

    await commitObjectDrag(node, 'tree-1', CAMERA, onMoveEnd);

    expect(onMoveEnd).toHaveBeenCalledWith('tree-1', 2, -3);
    expect(position).toHaveBeenCalledWith({ x: 0, y: 0 });
    expect(batchDraw).toHaveBeenCalledOnce();
  });

  it('also clears the temporary offset when the command fails', async () => {
    const { node, position, batchDraw } = dragNode(10, -10);
    const onMoveEnd = vi.fn().mockRejectedValue(new Error('request failed'));

    await expect(commitObjectDrag(node, 'plant-1', CAMERA, onMoveEnd)).rejects.toThrow(
      'request failed',
    );

    expect(position).toHaveBeenCalledWith({ x: 0, y: 0 });
    expect(batchDraw).toHaveBeenCalledOnce();
  });
});
