import * as THREE from 'three';

export const hexOf = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
export const sans = (weight: number) => `${weight} {s}px "Helvetica Neue", Arial, sans-serif`;

/** `font` has `{s}` for the size: steps down from `size` until `text` is under `width` px. */
export function fitFont(g: CanvasRenderingContext2D, font: string, text: string, width: number, size: number) {
  for (; size > 12; size -= 2) {
    g.font = font.replace('{s}', String(size));
    if (g.measureText(text).width < width) return;
  }
  g.font = font.replace('{s}', String(size)); // the floor, even if it still overflows
}

/** One line centred on the whole canvas; `size`, `baseline`: shares of its height, `fill`: of its width. */
export function drawLabel(g: CanvasRenderingContext2D, text: string, bg: string, fg: string, font: string, size: number, fill = 0.94, baseline = 0.525) {
  const { width: w, height: h } = g.canvas;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitFont(g, font, text, w * fill, Math.round(h * size));
  g.fillText(text, w / 2, h * baseline);
}

export function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}
