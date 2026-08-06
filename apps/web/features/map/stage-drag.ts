import type Konva from 'konva';

/**
 * A draggable child emits `dragend` and that event bubbles through Konva's
 * Stage. Only a drag whose target IS the Stage is a camera pan; treating a
 * dragged garden object as the Stage applies the same delta to both the
 * object and camera and makes the object appear to jump with the backdrop.
 */
export function isStagePanTarget(target: Konva.Node): target is Konva.Stage {
  const stage = target.getStage();
  return stage !== null && target === stage;
}
