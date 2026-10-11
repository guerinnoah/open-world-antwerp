import { existsSync } from 'node:fs';
import * as shapefile from 'shapefile';
import { RAW_DIR } from './config.ts';
import { interiorPoint, outlineGrid, pointInRing, project, type Pt } from './geo.ts';
import { lambert72ToLatLon } from './lambert72.ts';

/** OSM footprint → measured 3D GRB height; Flemish OSM outlines were imported from GRB, so most match one-to-one. */
export async function loadGrbHeights(): Promise<((outer: Pt[]) => number | undefined) | undefined> {
  const shp = `${RAW_DIR}/grb/buildings.shp`;
  if (!existsSync(shp)) {
    console.warn('No 3D GRB data (run pnpm map:fetch-grb); falling back to OSM and default heights.');
    return undefined;
  }
  const buildings: { outer: Pt[]; height: number }[] = [];
  const source = await shapefile.open(shp, `${RAW_DIR}/grb/buildings.dbf`);
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const { geometry, properties } = r.value as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>;
    const height = properties.HN_P99 as number; // m above ground: LiDAR roof surface, 99th percentile ≈ ridge
    if (properties.H_KWAL === 'Slecht' || !(height > 2)) continue;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) buildings.push({ outer: polygon[0].map(([x, y]) => project(...lambert72ToLatLon(x, y))), height });
  }
  return grbMatcher(buildings);
}

/** The GRB footprint under a point inside the OSM outline (not its vertex centroid, which an L- or U-shape leaves outside). */
export function grbMatcher(buildings: { outer: Pt[]; height: number }[]): (outer: Pt[]) => number | undefined {
  const near = outlineGrid(buildings);
  return (outer) => {
    const c = interiorPoint(outer);
    const nearby = near(c);
    const hit = nearby.find((g) => pointInRing(c, g.outer)) ?? nearby.find((g) => pointInRing(interiorPoint(g.outer), outer));
    return hit?.height;
  };
}
