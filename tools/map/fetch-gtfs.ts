import { createWriteStream, existsSync, statSync, createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { OUT_DIR, RAW_DIR } from './config.ts';

// De Lijn's national GTFS feed (keyless, ~204 MB) → trips per hour per line
const URL = 'https://api-management-opendata-production.azure-api.net/api/gtfs/feed/delijn/static';
const ZIP = `${RAW_DIR}/delijn-gtfs.zip`;
const DIR = `${RAW_DIR}/gtfs`;
const exec = promisify(execFile);

// line numbers repeat across De Lijn's cities: match number and colour
const graph = JSON.parse(await readFile(`${OUT_DIR}/graph.json`, 'utf8')) as { trams: { line: string; colour: number }[]; buses: { line: string; colour: number }[] };
const lineColour = new Map<string, string>();
for (const r of [...graph.trams, ...graph.buses]) lineColour.set(r.line, r.colour.toString(16).padStart(6, '0'));
const lines = new Set(lineColour.keys());

if (!existsSync(ZIP) || statSync(ZIP).size < 100_000_000) {
  console.log('Downloading De Lijn GTFS (~204 MB)…');
  await mkdir(RAW_DIR, { recursive: true });
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`GTFS download → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(ZIP));
}
await rm(DIR, { recursive: true, force: true });
await mkdir(DIR, { recursive: true });
await exec('unzip', ['-o', ZIP, 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar_dates.txt', '-d', DIR]);

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function* csv(file: string) {
  let idx: Record<string, number> | null = null;
  for await (const line of createInterface({ input: createReadStream(`${DIR}/${file}`), crlfDelay: Infinity })) {
    const row = splitCsv(line);
    if (!idx) { idx = Object.fromEntries(row.map((n, i) => [n.trim(), i])); continue; }
    const at = idx;
    yield (column: string) => row[at[column]] ?? '';
  }
}

const routeLine = new Map<string, string>();
for await (const get of csv('routes.txt')) {
  const short = get('route_short_name').trim();
  if (lineColour.get(short) === get('route_color').trim().toLowerCase()) routeLine.set(get('route_id'), short);
}

const trip = new Map<string, { line: string; service: string }>();
const services = new Set<string>();
for await (const get of csv('trips.txt')) {
  const line = routeLine.get(get('route_id'));
  if (!line) continue;
  const service = get('service_id');
  trip.set(get('trip_id'), { line, service });
  services.add(service);
}

// De Lijn's calendar.txt day flags are all 0
const serviceDates = new Map<string, Set<string>>();
const dateCount: Record<string, number> = {};
for await (const get of csv('calendar_dates.txt')) {
  const id = get('service_id');
  if (!services.has(id)) continue;
  const date = get('date');
  let set = serviceDates.get(id);
  if (!set) serviceDates.set(id, (set = new Set()));
  if (get('exception_type') === '1') { if (!set.has(date)) { set.add(date); dateCount[date] = (dateCount[date] ?? 0) + 1; } }
  else if (set.delete(date)) dateCount[date]--;
}
// busiest weekday and weekend day, which dodges holidays
const dow = (d: string) => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)).getDay();
let repWeekday = '', repWeekend = '';
for (const [d, c] of Object.entries(dateCount)) {
  if (dow(d) >= 1 && dow(d) <= 5) { if (!repWeekday || c > dateCount[repWeekday]) repWeekday = d; }
  else if (!repWeekend || c > dateCount[repWeekend]) repWeekend = d;
}

// first departure = lowest stop_sequence: GTFS rows aren't sorted
const tripHour = new Map<string, number>();
const tripSeq = new Map<string, number>();
for await (const get of csv('stop_times.txt')) {
  const id = get('trip_id');
  if (!trip.has(id)) continue;
  const seq = parseInt(get('stop_sequence'), 10);
  const prev = tripSeq.get(id);
  if (prev !== undefined && prev <= seq) continue;
  const hh = parseInt(get('departure_time'), 10);
  if (Number.isFinite(hh)) { tripSeq.set(id, seq); tripHour.set(id, ((hh % 24) + 24) % 24); }
}

const empty = () => new Array(24).fill(0);
const schedules: Record<string, { weekday: number[]; weekend: number[] }> = {};
for (const [id, { line, service }] of trip) {
  const hour = tripHour.get(id);
  const dates = serviceDates.get(service);
  if (hour === undefined || !dates) continue;
  const s = (schedules[line] ??= { weekday: empty(), weekend: empty() });
  if (dates.has(repWeekday)) s.weekday[hour]++;
  if (dates.has(repWeekend)) s.weekend[hour]++;
}

await writeFile(`${RAW_DIR}/gtfs-schedules.json`, JSON.stringify(schedules));
const matched = Object.keys(schedules).length;
const missing = [...lines].filter((l) => !schedules[l]);
const peak = (s: number[]) => s.reduce((a, b) => Math.max(a, b), 0);
const busiest = Object.entries(schedules).sort((a, b) => peak(b[1].weekday) - peak(a[1].weekday)).slice(0, 6)
  .map(([l, s]) => `${l}:${peak(s.weekday)}/h`).join(' ');
console.log(`Saved ${matched}/${lines.size} lines (weekday ${repWeekday}, weekend ${repWeekend}) to ${RAW_DIR}/gtfs-schedules.json. Peak weekday: ${busiest}. No GTFS match: ${missing.join(',') || 'none'}`);
