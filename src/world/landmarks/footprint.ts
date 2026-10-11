import type { Landmark } from '../cityData';
import { Kit } from './kit';

const STONE = 0xbdb4a2;

export function footprintModel(lm: Landmark): Kit {
  const kit = new Kit();
  for (const p of lm.parts) kit.extrude(p.ring, p.mh, p.h, STONE);
  if (!lm.parts.length) kit.box(1.5, 3, 1.5, 0, 0, 0, STONE);
  return kit;
}
