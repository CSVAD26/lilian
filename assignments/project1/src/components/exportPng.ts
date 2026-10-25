import type { Scene } from '../core/types';
import { renderScene } from '../render/renderScene';

export function exportPng(scene: Scene, light: number, size = 2400) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  renderScene(canvas.getContext('2d')!, scene, { w: size, h: size, light, showJoints: false, padding: size * 0.05 });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${scene.archetype}-${scene.seed}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
