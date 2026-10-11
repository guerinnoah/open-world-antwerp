import { mkdir, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { BBOX, RAW_DIR } from './config.ts';
import { round2 } from './geo.ts';
import { latLonToLambert72 } from './lambert72.ts';

const API = 'https://download.vlaanderen.be/bff/v1/Orders';
const PRODUCT_3D_GRB_LOD1_DHMV2 = 1210;

const corners = [
  latLonToLambert72(BBOX.south, BBOX.west),
  latLonToLambert72(BBOX.south, BBOX.east),
  latLonToLambert72(BBOX.north, BBOX.east),
  latLonToLambert72(BBOX.north, BBOX.west),
].map(([x, y]) => [round2(x), round2(y)]);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

const id = Number(process.argv[2]) || (await placeOrder());

async function placeOrder(): Promise<number> {
  const order = await api<{ member: { orderId: number }[] }>('', {
    method: 'POST',
    body: JSON.stringify({
      productId: PRODUCT_3D_GRB_LOD1_DHMV2,
      format: 'ShapeFile',
      discreteVersionIds: [],
      geographicalCrop: { clip: false, selectionEntityCode: 'Polygoon', polygon: { coordinates: [...corners, corners[0]] } },
      crs: 'LB72',
    }),
  });
  console.log(`Order ${order.member[0].orderId} placed, waiting for it to be processed…`);
  return order.member[0].orderId;
}

for (let i = 0; ; i++) {
  const status = await api<unknown>(`/${id}/status`);
  const text = JSON.stringify(status);
  if (/completed/i.test(text)) break;
  if (/failed|error|cancel/i.test(text)) throw new Error(`Order ${id} failed: ${text}`);
  if (i > 60) throw new Error(`Order ${id} still not done after 5 minutes: ${text}`);
  await new Promise((r) => setTimeout(r, 5000));
}

const details = await api<{ downloads: { id: string }[] }>(`/${id}`);
const fileId = details.downloads[0].id.split('/').pop();
const res = await fetch(`${API}/${id}/download/${fileId}`);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));

await mkdir(`${RAW_DIR}/grb`, { recursive: true });
let written = 0;
for (const [path, data] of Object.entries(zip)) {
  const ext = path.split('.').pop()!.toLowerCase();
  if (!['shp', 'dbf', 'shx', 'prj'].includes(ext) || !/GRBGebL1D2/i.test(path)) continue;
  await writeFile(`${RAW_DIR}/grb/buildings.${ext}`, data);
  written++;
}
if (!written) throw new Error(`No shapefile in the zip: ${Object.keys(zip).join(', ')}`);
console.log(`Saved 3D GRB shapefile to ${RAW_DIR}/grb/buildings.{shp,dbf}`);
