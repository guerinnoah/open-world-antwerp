import { mkdir, writeFile, access } from 'node:fs/promises';

export const AVATARS = ['Female_Adult_01', 'Female_Adult_03', 'Female_Adult_06', 'Female_Adult_08', 'Male_Adult_01', 'Male_Adult_04', 'Male_Adult_08', 'Male_Adult_12'];
export const ANIMS = {
  f: { walk: 'xy/f_walk_neutral', run: 'xy/f_run_neutral', idle: 'static/f_idle_neutral_01' },
  m: { walk: 'xy/m_walk_neutral', run: 'xy/m_run_neutral', idle: 'static/m_idle_neutral_01' },
};

const REPO = 'microsoft/Microsoft-Rocketbox';
const RAW = `https://raw.githubusercontent.com/${REPO}/master/Assets`;
const API = `https://api.github.com/repos/${REPO}/contents/Assets`;
const OUT = 'data/raw/people';
const ua = { headers: { 'User-Agent': 'gta-antwerp-asset-pipeline/0.1' } };
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
for (const name of AVATARS) {
  const dir = `${OUT}/${name}`;
  await mkdir(dir, { recursive: true });
  const base = `Adults/${name}`;
  await download(`${RAW}/Avatars/${base}/Export/${name}.fbx`, `${dir}/${name}.fbx`);
  const files = (await (await fetch(`${API}/Avatars/${base}/Textures`, ua)).json()) as { name: string }[];
  for (const f of files.filter((f) => /_color\.tga$/i.test(f.name))) {
    await download(`${RAW}/Avatars/${base}/Textures/${f.name}`, `${dir}/${f.name}`);
  }
}
