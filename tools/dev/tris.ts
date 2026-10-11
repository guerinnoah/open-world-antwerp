// pnpm tris <id>
import { readFileSync } from 'node:fs';
import type { CityData } from '../../src/world/cityData.ts';

const id = process.argv[2];
const city = JSON.parse(readFileSync('public/map/city.json', 'utf8')) as CityData;
const lm = city.landmarks.find((l) => l.id === id);
if (!lm) throw new Error(`no landmark "${id}"; have ${city.landmarks.map((l) => l.id).join(', ')}`);
const mod = await import(`../../src/world/landmarks/${id}.ts`);
const g = mod[id](lm);
console.log(`${id}: ${g.getAttribute('position').count / 3} triangles`);
