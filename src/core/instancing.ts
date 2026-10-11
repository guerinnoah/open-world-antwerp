import type * as THREE from 'three';

export function uploadFirst(attr: THREE.BufferAttribute | null | undefined, count: number) {
  if (!attr) return;
  attr.clearUpdateRanges();
  if (count <= 0) return;
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}

/**
 * Frees the CPU copy once on the GPU (buildings: ~100 MB); compute bounds first, no edits or raycasts after.
 * A lost WebGL context can't re-upload it, so main.ts offers a reload instead.
 */
export function freeAfterUpload(geometry: THREE.BufferGeometry) {
  const free = function (this: { array: unknown }) {
    this.array = null;
  };
  for (const attr of Object.values(geometry.attributes)) (attr as THREE.BufferAttribute).onUpload(free);
  geometry.index?.onUpload(free);
}
