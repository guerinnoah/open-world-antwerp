import type { WallMaterial } from '../../src/world/cityData.ts';

// sRGB as seen on Antwerp streets, weighted by frequency
type Swatches = [weight: number, colour: number][];

const RENDER: Swatches = [
  [20, 0xe8e5de], [14, 0xe2dacb], [10, 0xd0cdc6], [8, 0xd5c7ab], [4, 0xe0d2a6], [3, 0xc6c8b8], [3, 0xc5ccd1],
  [3, 0xdcc4b6], [4, 0xaaa79f], [2, 0x5a5c5e], [1, 0x47534a], [1, 0x7d4a40],
];
const CONCRETE: Swatches = [[3, 0xc9c6bf], [2, 0xb0aea8], [2, 0xd8d4cc], [1, 0x9a9893]];
const RED_BRICK: Swatches = [[10, 0x9c5a45], [8, 0x87503f], [5, 0x6e4337], [3, 0x74504a], [3, 0xa86d52]];
const YELLOW_BRICK: Swatches = [[5, 0xc4ab80], [3, 0xb4a07c], [2, 0xa8977d]];
const ASHLAR: Swatches = [[6, 0xd2c9b6], [4, 0xbfb8a8], [2, 0xddd3bf]];
const SLATE: Swatches = [[5, 0x3f4246], [1, 0x4a4b4f]];
const CLAY: Swatches = [[5, 0x8b4a37], [3, 0x7a4334], [2, 0x86584a]];
const GLAZED: Swatches = [[1, 0x2f3033]];

const NAMED_COLOURS: Record<string, number> = {
  white: 0xebe7df, lightgrey: 0xc9c6bf, grey: 0x9a9893, gray: 0x9a9893, darkgrey: 0x5e5c59, black: 0x3a3836,
  red: 0x8a4b3a, darkred: 0x6e3a30, brown: 0x6e4a36, beige: 0xd8c7a3, yellow: 0xd8b860, tan: 0xc9a467,
};

const INDUSTRIAL = new Set(['industrial', 'warehouse', 'hangar', 'factory', 'manufacture', 'storage_tank']);
const SHEDS = new Set(['garage', 'garages', 'shed', 'roof', 'carport', 'service', 'kiosk']);
const CHURCHES = new Set(['church', 'cathedral', 'chapel', 'basilica']);

function colourOf(v: string | undefined): number | undefined {
  if (!v) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(v)) return parseInt(v.slice(1), 16);
  return NAMED_COLOURS[v.toLowerCase()];
}

function pick(list: Swatches, r: number): number {
  let left = r * list.reduce((s, [w]) => s + w, 0);
  for (const [w, c] of list) if ((left -= w) < 0) return c;
  return list[list.length - 1][1];
}

export function facadeOf(
  t: Record<string, string>, height: number, area: number, oldTown: boolean, rand: (salt: number) => number,
): { c: number; r: number; m?: WallMaterial } {
  const kind = t.building ?? t['building:part'];
  const material = t['building:material'];
  const roll = rand(1);
  let m: WallMaterial | 0;
  let walls: Swatches;
  if (material === 'brick') [m, walls] = [1, RED_BRICK];
  else if (material === 'stone' || material === 'limestone' || material === 'sandstone') [m, walls] = [3, ASHLAR];
  else if (material === 'concrete' || material === 'glass' || material === 'metal') [m, walls] = [0, CONCRETE];
  else if (material === 'plaster') [m, walls] = [0, RENDER];
  else if (CHURCHES.has(kind)) [m, walls] = [3, ASHLAR];
  else if (INDUSTRIAL.has(kind)) [m, walls] = roll < 0.6 ? [1, RED_BRICK] : [0, CONCRETE];
  else if (SHEDS.has(kind)) [m, walls] = roll < 0.3 ? [1, RED_BRICK] : [0, CONCRETE];
  else if (height >= 30) [m, walls] = roll < 0.6 ? [0, CONCRETE] : [3, ASHLAR];
  else {
    // old town: render and stone; outside, the 19th–20th-century brick belt
    const ashlar = (oldTown ? 0.14 : 0.06) + (area > 600 ? 0.12 : 0);
    const brick = oldTown ? 0.33 : 0.38, yellow = oldTown ? 0.08 : 0.14;
    [m, walls] = roll < ashlar ? [3, ASHLAR] : roll < ashlar + brick ? [1, RED_BRICK] : roll < ashlar + brick + yellow ? [2, YELLOW_BRICK] : [0, RENDER];
  }
  const c = colourOf(t['building:colour']) ?? pick(walls, rand(2));

  const roofMaterial = t['roof:material'];
  const roofRoll = rand(3);
  const roofs = roofMaterial === 'slate' ? SLATE : roofMaterial === 'roof_tiles' || roofMaterial === 'tile' ? CLAY
    : roofRoll < (oldTown ? 0.62 : 0.45) ? SLATE : roofRoll < 0.9 ? CLAY : GLAZED;
  const r = colourOf(t['roof:colour']) ?? pick(roofs, rand(4));
  return m ? { c, r, m } : { c, r };
}
