import { existsSync } from 'node:fs';
import polygonClipping, { type Polygon } from 'polygon-clipping';
import * as shapefile from 'shapefile';
import { RAW_DIR } from './config.ts';
import { interiorPoint, outlineGrid, pointInRing, project, signedArea, type Pt } from './geo.ts';
import { lambert72ToLatLon } from './lambert72.ts';

/** GRB LBLTYPE: 'hoofdgebouw'/'bijgebouw' on the ground, 'afdak' canopy, 'verdieping' jutting upper floor. */
export interface GrbFootprint {
  outer: Pt[];
  height: number;
  type?: string;
}

export interface GrbMatch {
  height: number;
  type: string;
  /** Share of the outline on ground-level GRB; 'verdieping' only. */
  ground: number;
}

const RAISED = new Set(['afdak', 'verdieping']);

/** Flemish OSM outlines were imported from GRB, so most match one-to-one. */
export async function loadGrbHeights(): Promise<((outer: Pt[]) => GrbMatch | undefined) | undefined> {
  const shp = `${RAW_DIR}/grb/buildings.shp`;
  if (!existsSync(shp)) {
    console.warn('No 3D GRB data (run pnpm map:fetch-grb); falling back to OSM and default heights.');
    return undefined;
  }
  const buildings: GrbFootprint[] = [];
  const source = await shapefile.open(shp, `${RAW_DIR}/grb/buildings.dbf`);
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const { geometry, properties } = r.value as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>;
    const height = properties.HN_P99 as number; // m, LiDAR roof P99 ≈ ridge
    if (properties.H_KWAL === 'Slecht' || !(height > 2)) continue;
    const type = properties.LBLTYPE as string;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) buildings.push({ outer: polygon[0].map(([x, y]) => project(...lambert72ToLatLon(x, y))), height, type });
  }
  return grbMatcher(buildings);
}

/** A footprint under 1/4 or over 4× the outline's area is another building. */
export function grbMatcher(buildings: GrbFootprint[]): (outer: Pt[]) => GrbMatch | undefined {
  const near = outlineGrid(buildings);
  const areas = new Map(buildings.map((g) => [g, Math.abs(signedArea(g.outer))]));
  return (outer) => {
    const c = interiorPoint(outer);
    const nearby = near(c);
    const hit = nearby.find((g) => pointInRing(c, g.outer)) ?? nearby.find((g) => pointInRing(interiorPoint(g.outer), outer));
    if (!hit) return undefined;
    const area = Math.abs(signedArea(outer));
    const ratio = area / areas.get(hit)!;
    if (ratio < 0.25 || ratio > 4) return undefined;
    const type = hit.type ?? 'hoofdgebouw';
    return { height: hit.height, type, ground: type === 'verdieping' ? groundShare(outer, area, footprintsOver(near, outer)) : 1 };
  };
}

function footprintsOver(near: (p: Pt) => GrbFootprint[], outer: Pt[]): GrbFootprint[] {
  const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
  const found = new Set<GrbFootprint>();
  for (let x = Math.min(...xs); x < Math.max(...xs) + 50; x += 50) {
    for (let z = Math.min(...zs); z < Math.max(...zs) + 50; z += 50) for (const g of near([x, z])) found.add(g);
  }
  return [...found];
}

function groundShare(outer: Pt[], area: number, nearby: GrbFootprint[]): number {
  const ring = (r: Pt[]): Polygon => [[...r, r[0]]];
  const ground = nearby.filter((g) => !RAISED.has(g.type ?? ''));
  if (!ground.length) return 0;
  try {
    const under = polygonClipping.intersection(ring(outer), polygonClipping.union(ring(ground[0].outer), ...ground.slice(1).map((g) => ring(g.outer))));
    return under.reduce((s, poly) => s + poly.reduce((a, r, i) => a + (i ? -1 : 1) * Math.abs(signedArea(r.slice(0, -1) as Pt[])), 0), 0) / area;
  } catch {
    return 1;
  }
}
