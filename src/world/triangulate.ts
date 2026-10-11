import earcut from 'earcut';

export function triangulate(rings: number[][]): { flat: number[]; tris: number[] } {
  const flat = rings.flat();
  const holes: number[] = [];
  let offset = 0;
  for (const r of rings) {
    if (offset) holes.push(offset / 2);
    offset += r.length;
  }
  const tris = earcut(flat, holes, 2);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 2, b = tris[i + 1] * 2, c = tris[i + 2] * 2;
    if ((flat[b + 1] - flat[a + 1]) * (flat[c] - flat[a]) - (flat[b] - flat[a]) * (flat[c + 1] - flat[a + 1]) < 0) {
      [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
    }
  }
  return { flat, tris };
}
