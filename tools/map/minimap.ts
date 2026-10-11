import sharp from 'sharp';
import type { CityData } from '../../src/world/cityData.ts';
import { MINIMAP_SCALE } from '../../src/ui/minimapConfig.ts';

export async function renderMinimap(city: CityData, file: string) {
  const { minX, minZ, maxX, maxZ } = city.bounds;
  const w = Math.ceil((maxX - minX) * MINIMAP_SCALE), h = Math.ceil((maxZ - minZ) * MINIMAP_SCALE);
  const px = (x: number) => ((x - minX) * MINIMAP_SCALE).toFixed(1);
  const pz = (z: number) => ((z - minZ) * MINIMAP_SCALE).toFixed(1);
  const line = (p: number[]) => {
    let d = `M${px(p[0])} ${pz(p[1])}`;
    for (let i = 2; i < p.length; i += 2) d += `L${px(p[i])} ${pz(p[i + 1])}`;
    return d;
  };
  const ring = (r: number[]) => `${line(r)}Z`;

  const parts: string[] = [`<rect width="${w}" height="${h}" fill="#c9c3b8"/>`];
  for (const [kind, fill] of [['green', '#8fae6d'], ['plaza', '#d6cfc2'], ['water', '#5d8fb0']] as const) {
    const d = city.areas.filter((a) => a.k === kind).map((a) => a.rings.map(ring).join('')).join('');
    parts.push(`<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`);
  }
  const landmarkRings = city.landmarks.filter((l) => l.ring.length).map((l) => {
    const c = Math.cos(l.angle), s = Math.sin(l.angle);
    const out: number[] = [];
    for (let i = 0; i < l.ring.length; i += 2) out.push(l.x + l.ring[i] * c - l.ring[i + 1] * s, l.z + l.ring[i] * s + l.ring[i + 1] * c);
    return out;
  });
  parts.push(`<path d="${[...city.buildings.map((b) => b.rings[0]), ...landmarkRings].map(ring).join('')}" fill="#a49c90"/>`);
  for (const kinds of [['service', 'pedestrian'], ['minor'], ['major']]) {
    const colour = kinds[0] === 'major' ? '#fdfaf3' : '#f1ece2';
    const byWidth = new Map<number, string[]>();
    for (const r of city.roads) {
      if (!kinds.includes(r.k)) continue;
      const width = Math.max(r.w * MINIMAP_SCALE, 1.5);
      byWidth.set(width, [...(byWidth.get(width) ?? []), line(r.p)]);
    }
    for (const [width, ds] of byWidth) {
      parts.push(`<path d="${ds.join('')}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join('')}</svg>`;
  const webp = await sharp(Buffer.from(svg), { limitInputPixels: false }).webp({ quality: 82 }).toBuffer();
  await sharp(webp).toFile(file);
  return { width: w, height: h, bytes: webp.length };
}
