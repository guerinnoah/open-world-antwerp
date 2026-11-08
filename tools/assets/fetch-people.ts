import { mkdir, writeFile, access, readdir } from 'node:fs/promises';

interface Avatar {
  name: string;
  weight: number; // % of the crowd
  european: boolean;
}

// Antwerp 2023: 59.6% Belgian, neighbouring or EU background; order = load priority (Crowd.load)
export const ROSTER: Avatar[] = [
  { name: 'Female_Adult_01', weight: 9, european: true },
  { name: 'Male_Adult_08', weight: 9, european: true },
  { name: 'Female_Adult_06', weight: 8, european: false },
  { name: 'Male_Adult_17', weight: 9, european: false },
  { name: 'Female_Adult_08', weight: 8, european: true },
  { name: 'Male_Adult_06', weight: 8, european: true },
  { name: 'Female_Adult_14', weight: 8, european: true },
  { name: 'Male_Adult_03', weight: 7, european: true },
  { name: 'Business_Female_02', weight: 7, european: true },
  { name: 'Delivery_Male_01', weight: 6, european: true },
  { name: 'Male_Adult_12', weight: 5, european: false },
  { name: 'Female_Adult_11', weight: 4, european: false },
  { name: 'Male_Adult_20', weight: 4, european: false },
  { name: 'Female_Party_02', weight: 3, european: false },
  { name: 'Female_Adult_03', weight: 3, european: false },
  { name: 'Wood_Male_01', weight: 2, european: false },
];
export const genderOf = (name: string) => (name.includes('Female') ? 'f' : 'm');
export const ANIMS = {
  f: { walk: 'xy/f_walk_neutral', run: 'xy/f_run_neutral', idle: 'static/f_idle_neutral_01' },
  m: { walk: 'xy/m_walk_neutral', run: 'xy/m_run_neutral', idle: 'static/m_idle_neutral_01' },
};

const REPO = 'microsoft/Microsoft-Rocketbox';
const RAW = `https://raw.githubusercontent.com/${REPO}/master/Assets`;
const API = `https://api.github.com/repos/${REPO}/contents/Assets`;
const OUT = 'data/raw/people';
const ua = { headers: { 'User-Agent': 'open-world-antwerp-asset-pipeline/0.1' } };
const exists = (p: string) => access(p).then(() => true, () => false);

async function download(url: string, file: string) {
  if (await exists(file)) return;
  const res = await fetch(url, ua);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(file);
}

await mkdir(`${OUT}/anims`, { recursive: true });
for (const g of Object.values(ANIMS)) {
  for (const path of Object.values(g)) {
    const [folder, name] = path.split('/');
    await download(`${RAW}/Animations/all_animations_max_motextr_${folder}/${name}.max.fbx`, `${OUT}/anims/${name}.fbx`);
  }
}
for (const { name } of ROSTER) {
  const dir = `${OUT}/${name}`;
  await mkdir(dir, { recursive: true });
  const base = `${/_(Adult|Party)_/.test(name) ? 'Adults' : 'Professions'}/${name}`;
  await download(`${RAW}/Avatars/${base}/Export/${name}.fbx`, `${dir}/${name}.fbx`);
  if ((await readdir(dir)).some((f) => f.endsWith('_body_color.tga'))) continue; // 60/h API limit, and bake-people imports this file
  const files = (await (await fetch(`${API}/Avatars/${base}/Textures`, ua)).json()) as { name: string }[];
  for (const f of files.filter((f) => /_color\.tga$/i.test(f.name))) {
    await download(`${RAW}/Avatars/${base}/Textures/${f.name}`, `${dir}/${f.name}`);
  }
}
