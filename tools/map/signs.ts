import type { Building, Road, RoadGraph, ShopKind, Sign, SignStyle } from '../../src/world/cityData.ts';
import { besideRoad, pointInRing, project, round, round2, roadGrid, type OsmElement, type Outline, type Pt } from './geo.ts';

function pointOf(e: OsmElement): Pt | undefined {
  if (e.lat !== undefined) return project(e.lat, e.lon!);
  if (e.geometry?.length) {
    const g = e.geometry.filter(Boolean);
    return project(g.reduce((s, q) => s + q.lat, 0) / g.length, g.reduce((s, q) => s + q.lon, 0) / g.length);
  }
  if (e.bounds) return project((e.bounds.minlat + e.bounds.maxlat) / 2, (e.bounds.minlon + e.bounds.maxlon) / 2);
  return undefined;
}

const HORECA_STYLE: Record<string, SignStyle> = {
  cafe: 'cafe', pub: 'cafe', bar: 'cafe', restaurant: 'restaurant', fast_food: 'fastfood', ice_cream: 'fastfood',
  bank: 'bank', pharmacy: 'pharmacy',
};
const SHOP_STYLE: Record<string, SignStyle> = {
  bakery: 'bakery', pastry: 'bakery', chocolate: 'bakery', confectionery: 'bakery',
  jewelry: 'jewelry', watches: 'jewelry',
  clothes: 'fashion', shoes: 'fashion', boutique: 'fashion', bag: 'fashion', fashion_accessories: 'fashion', cosmetics: 'fashion', perfumery: 'fashion',
  supermarket: 'food', convenience: 'food', deli: 'food', butcher: 'food', greengrocer: 'food', alcohol: 'food', wine: 'food', cheese: 'food', coffee: 'food', tea: 'food', seafood: 'food',
  hairdresser: 'service', beauty: 'service', optician: 'service', laundry: 'service', dry_cleaning: 'service', mobile_phone: 'service', travel_agency: 'service', tattoo: 'service', copyshop: 'service',
  chemist: 'pharmacy',
};
const OTHER_STYLE: Record<string, SignStyle> = {
  hotel: 'hotel', hostel: 'hotel', guest_house: 'hotel',
  museum: 'culture', gallery: 'culture', theatre: 'culture', cinema: 'culture', arts_centre: 'culture', events_venue: 'culture',
  nightclub: 'club', casino: 'club',
  library: 'public', post_office: 'public', school: 'public', university: 'public', college: 'public', townhall: 'public',
  courthouse: 'public', community_centre: 'public', kindergarten: 'public',
  bureau_de_change: 'service', car_rental: 'service', fitness_centre: 'shop', sports_centre: 'shop',
  doctors: 'plate', dentist: 'plate', clinic: 'plate',
};

function shorten(name: string): string {
  if (name.length <= 40) return name;
  const cut = name.slice(0, 41).lastIndexOf(' ');
  return name.slice(0, cut > 12 ? cut : 40);
}

function styleOf(t: Record<string, string>): SignStyle | undefined {
  if (HORECA_STYLE[t.amenity]) return HORECA_STYLE[t.amenity];
  if (t.shop) return SHOP_STYLE[t.shop] ?? 'shop';
  const other = OTHER_STYLE[t.tourism] ?? OTHER_STYLE[t.amenity] ?? OTHER_STYLE[t.leisure];
  if (other) return other;
  if (t.office || t.craft) return 'plate';
  return undefined;
}

/** Chain house colours, matched on the name's start; chains never get a logo. */
const BRANDS: [RegExp, number][] = [
  [/^albert heijn|^ah\b/i, 0x00a0e2], [/delhaize/i, 0xd7171f], [/^carrefour/i, 0x004e9f], [/^lidl/i, 0x0050aa],
  [/^aldi/i, 0x00205b], [/^colruyt/i, 0xf28c00], [/^okay/i, 0xe2001a], [/^spar\b/i, 0x00843d], [/^kruidvat/i, 0xe30613],
  [/^hema/i, 0xe2001a], [/^zara/i, 0x111111], [/^h&m/i, 0xe50010], [/^action\b/i, 0x0068b3], [/^fnac/i, 0xe1a400],
  [/^mediamarkt|^media markt/i, 0xdf0000], [/^primark/i, 0x0b9bd7], [/^jbc/i, 0xd40f1f], [/^torfs/i, 0x1a1a1a],
  [/^panos/i, 0xc8102e], [/^exki/i, 0x6b8f2a], [/^starbucks/i, 0x00704a], [/^mcdonald/i, 0xda291c], [/^quick\b/i, 0xe3001b],
  [/^burger king/i, 0xd62300], [/^pizza hut/i, 0xc8102e], [/^domino/i, 0x006491], [/^ici paris/i, 0x111111],
  [/^di\b/i, 0xe5007e], [/^c&a/i, 0x0b4b9b], [/^inno\b/i, 0x111111], [/^bpost/i, 0xe2001a], [/^kbc/i, 0x00aeef],
  [/^bnp paribas|^bnp/i, 0x00915a], [/^ing\b/i, 0xff6200], [/^belfius/i, 0xc30045], [/^argenta/i, 0x7ab929],
];

const OPERATOR_LOGO: ReadonlySet<SignStyle> = new Set(['public', 'culture']);

export function logoItemsOf(t: Record<string, string>): string[] {
  const style = styleOf(t);
  if (!t.name || !style || style === 'plate') return [];
  if (t.brand || t['brand:wikidata'] || BRANDS.some(([re]) => re.test(t.name))) return [];
  const items = [t.wikidata, OPERATOR_LOGO.has(style) ? t['operator:wikidata'] : undefined];
  return items.flatMap((q) => (q ? [q.split(';')[0].trim()] : [])).filter((q) => /^Q\d+$/.test(q));
}

const SHOP_KIND: Partial<Record<SignStyle, ShopKind>> = {
  shop: 1, cafe: 2, restaurant: 2, fastfood: 2, fashion: 3, food: 4, bakery: 5, jewelry: 6, pharmacy: 7, bank: 7, service: 7,
};

export function markShopKinds(signs: Sign[], buildings: Building[]) {
  for (const [i, , , , style] of signs) {
    const kind = SHOP_KIND[style];
    const b = buildings[i];
    if (!kind || b.sh === 2) continue;
    if (kind === 2 || !b.sh || b.sh === 1) b.sh = kind;
  }
}

interface SignOutput {
  signs: Sign[];
  terraces: number[];
}

export function placeSigns(
  elements: OsmElement[],
  index: Map<Building, number>,
  near: (p: Pt) => Outline[],
  open: (p: Pt) => boolean,
  logoOf: (tags: Record<string, string>) => { index: number; aspect: number; named: boolean } | undefined,
): SignOutput {
  const signs: Sign[] = [];
  const terraces: number[] = [];
  const taken = new Map<string, [number, number][]>();

  for (const e of elements) {
    const t = e.tags;
    if (!t?.name || t.building === 'cathedral' || t.building === 'church') continue;
    const style = styleOf(t);
    const p = style && pointOf(e);
    if (!style || !p) continue;
    const candidates = near(p).filter((o) => index.has(o.b) && !o.b.hd && !o.b.nw && !o.b.mh);
    let host = candidates.find((o) => pointInRing(p, o.outer));
    let best = Infinity;
    let edge = -1, along = 0;
    const consider = (o: Outline, onlyStreet: boolean) => {
      const r = o.outer;
      for (let i = 0; i < r.length; i++) {
        if (onlyStreet && !(o.b.sf ?? []).includes(i)) continue;
        const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
        if (len2 < 4) continue;
        const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / len2));
        const d = Math.hypot(p[0] - ax - dx * u, p[1] - az - dz * u);
        if (d < best) {
          best = d;
          edge = i;
          along = u;
          host = o;
        }
      }
    };
    if (host) {
      consider(host, true);
      if (edge < 0) consider(host, false);
    } else {
      for (const o of candidates) consider(o, true);
      if (best > 6) continue;
    }
    if (!host || edge < 0) continue;
    const r = host.outer;
    const [ax, az] = r[edge], [bx, bz] = r[(edge + 1) % r.length];
    const len = Math.hypot(bx - ax, bz - az);
    const plate = style === 'plate';
    const big = style === 'hotel' || style === 'culture' || style === 'public';
    let width = plate
      ? Math.min(Math.max(0.5, t.name.length * 0.055 + 0.25), 1.1, len - 0.4)
      : Math.min(Math.max(2.2, shorten(t.name).length * 0.28 + 0.8), len - 0.4, big ? 9 : 7);
    const logo = plate ? undefined : logoOf(t);
    if (logo) {
      const logoWidth = 0.75 * 0.75 * logo.aspect; // 0.75 m sign, logo 3/4 of it (src/world/signs.ts)
      const most = Math.min(len - 0.4, big ? 9 : 7);
      const named = logo.named && width + logoWidth <= most;
      width = Math.min(Math.max(1.5, named ? width + logoWidth : logoWidth + 0.5), most);
    }
    const key = `${plate ? 'p' : ''}${index.get(host.b)}:${edge}`;
    const spans = taken.get(key) ?? [];
    let centre = along * len;
    centre = Math.min(Math.max(centre, width / 2 + 0.2), len - width / 2 - 0.2);
    const overlaps = ([s0, s1]: [number, number]) => centre + width / 2 > s0 && centre - width / 2 < s1;
    // spans stay sorted, so moving past one never hits an earlier one
    for (const span of spans) {
      if (!overlaps(span)) continue;
      const after = span[1] + width / 2 + 0.2;
      if (after + width / 2 < len - 0.2) centre = after;
      else {
        const left = centre - width / 2;
        width = Math.max(0, span[0] - 0.4 - left);
        centre = left + width / 2;
      }
    }
    if (width < (plate ? 0.5 : 1.5) || spans.some(overlaps)) continue;
    spans.push([centre - width / 2, centre + width / 2]);
    spans.sort((a, b) => a[0] - b[0]);
    taken.set(key, spans);
    const brand = BRANDS.find(([re]) => re.test(t.name) || re.test(t.brand ?? ''))?.[1];
    const sign: Sign = [index.get(host.b)!, edge, Math.round((centre / len) * 1000) / 1000, round(width), style, shorten(t.name)];
    if (brand !== undefined || logo) sign.push(brand ?? null);
    if (logo) sign.push(logo.index);
    signs.push(sign);

    if (style === 'cafe' || style === 'restaurant' || (style === 'fastfood' && t.amenity === 'ice_cream')) {
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const nx = uz, nz = -ux; // outward: outer rings wind positive
      const colour = Math.floor(Math.abs(Math.sin(p[0] * 13.7 + p[1]) * 1e4)) % 6;
      for (const offset of [0, -2.4, 2.4]) {
        const s = centre + offset;
        if (s < 0.8 || s > len - 0.8) continue;
        const x = ax + ux * s + nx * 3, z = az + uz * s + nz * 3;
        if (!open([x, z]) || !open([x + nx * 1.2, z + nz * 1.2]) || !open([x - nx * 1.2, z - nz * 1.2])) continue;
        terraces.push(round(x), round(z), round2(Math.atan2(nz, nx)), colour);
      }
    }
  }
  return { signs, terraces };
}

export function offRoad(roads: Road[]) {
  const near = roadGrid(roads.filter((r) => r.k !== 'foot' && r.k !== 'pedestrian'), 40);
  return (p: Pt) => !besideRoad(p, near(p), 0.6);
}

export function placeStreetPlates(graphs: RoadGraph[], index: Map<Building, number>, near: (p: Pt) => Outline[]): Sign[] {
  const plates: Sign[] = [];
  const placed = new Map<string, Pt[]>();
  for (const { nodes, edges } of graphs) {
    const at = new Map<number, typeof edges>();
    for (const e of edges) {
      for (const v of [e.a, e.b]) at.set(v, [...(at.get(v) ?? []), e]);
    }
    for (const [v, incident] of at) {
      const names = new Set(incident.map((e) => e.n).filter(Boolean));
      if (incident.length < 3 && names.size < 2) continue;
      const jx = nodes[v * 2], jz = nodes[v * 2 + 1];
      for (const e of incident) {
        if (!e.n || e.p.length < 4) continue;
        const fromA = e.a === v;
        const [x1, z1] = fromA ? [e.p[2], e.p[3]] : [e.p[e.p.length - 4], e.p[e.p.length - 3]];
        const dl = Math.hypot(x1 - jx, z1 - jz);
        if (dl < 1) continue;
        const dx = (x1 - jx) / dl, dz = (z1 - jz) / dl;
        if ((placed.get(e.n) ?? []).some(([px, pz]) => Math.hypot(px - jx, pz - jz) < 30)) continue;
        let best: { o: Outline; edge: number; t: number; score: number } | undefined;
        for (const o of near([jx, jz])) {
          if (!index.has(o.b) || o.b.hd || o.b.nw || o.b.mh) continue;
          const r = o.outer;
          for (let i = 0; i < r.length; i++) {
            if (!(o.b.sf ?? []).includes(i)) continue;
            const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
            const len = Math.hypot(bx - ax, bz - az);
            if (len < 3) continue;
            const ux = (bx - ax) / len, uz = (bz - az) / len;
            if (Math.abs(ux * dx + uz * dz) < 0.94) continue;
            const nx = uz, nz = -ux;
            const side = (ax - jx) * -dz + (az - jz) * dx;
            if (Math.abs(side) < e.w / 2 + 1 || Math.abs(side) > e.w / 2 + 9) continue;
            if ((jx - ax) * nx + (jz - az) * nz < 0.5) continue;
            const sa = (ax - jx) * dx + (az - jz) * dz, sb = (bx - jx) * dx + (bz - jz) * dz;
            const near0 = Math.min(sa, sb);
            if (near0 < -1 || near0 > 14) continue;
            const score = near0 + Math.abs(side) * 0.3;
            if (best && score >= best.score) continue;
            const inset = Math.min(0.9, len / 2) / len;
            best = { o, edge: i, t: sa < sb ? inset : 1 - inset, score };
          }
        }
        if (!best) continue;
        const width = Math.min(Math.max(0.7, e.n.length * 0.075 + 0.3), 1.8);
        plates.push([index.get(best.o.b)!, best.edge, Math.round(best.t * 1000) / 1000, round(width), 'street', shorten(e.n)]);
        placed.set(e.n, [...(placed.get(e.n) ?? []), [jx, jz]]);
      }
    }
  }
  return plates;
}

/** Velo stations as [x, z, angle, docks], docks along the nearest street. */
export function veloStations(elements: OsmElement[], roads: Road[], clear: (p: Pt) => boolean): number[] {
  const out: number[] = [];
  for (const e of elements) {
    const t = e.tags;
    if (t?.amenity !== 'bicycle_rental' || !/velo/i.test(`${t.network} ${t.brand}`)) continue;
    let p = pointOf(e);
    if (!p) continue;
    let best = Infinity, angle = 0, away: Pt = [0, 0];
    for (const r of roads) {
      if (r.k === 'foot' || r.k === 'cycle') continue;
      for (let k = 0; k < r.p.length - 2; k += 2) {
        const [ax, az, bx, bz] = [r.p[k], r.p[k + 1], r.p[k + 2], r.p[k + 3]];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2));
        const qx = ax + dx * u, qz = az + dz * u;
        const d = Math.hypot(p[0] - qx, p[1] - qz);
        if (d < best) {
          best = d;
          angle = Math.atan2(dz, dx);
          const l = Math.sqrt(l2);
          const side = Math.sign((p[0] - ax) * -dz + (p[1] - az) * dx) || 1;
          away = [(-dz / l) * side, (dx / l) * side];
        }
      }
    }
    if (best > 30) continue;
    const capacity = Math.min(Math.max(Number(t.capacity) || 12, 6), 24);
    const [ux, uz] = [Math.cos(angle), Math.sin(angle)];
    const fits = ([x, z]: Pt, half: number) => [-half, -half / 2, 0, half / 2, half].every((s) => [-0.9, 0, 0.9].every((o) =>
      clear([x + ux * s + away[0] * o, z + uz * s + away[1] * o])));
    let found: [Pt, number] | undefined;
    search: for (const docks of [capacity, Math.ceil(capacity * 0.6), 6]) {
      for (const across of [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, -0.5, -1]) {
        for (const along of [0, 2, -2, 4, -4, 6, -6]) {
          const q: Pt = [p[0] + away[0] * across + ux * along, p[1] + away[1] * across + uz * along];
          if (fits(q, (docks * 0.75) / 2)) {
            found = [q, docks];
            break search;
          }
        }
      }
    }
    if (!found) continue;
    [p] = found;
    out.push(round(p[0]), round(p[1]), round2(angle), found[1]);
  }
  return out;
}
