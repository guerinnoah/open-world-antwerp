// Shape of public/map/city.json and graph.json (tools/map/build.ts). Local metres: +x = east, +z = south.
/** Flat [x0, z0, x1, z1, …], not closed (last point ≠ first). */
type Ring = number[];

export interface Building {
  h: number; // roof height above ground (m)
  mh?: number; // where the walls start, for parts like tower sections (m)
  /** Average wall and pitched-roof colour (sRGB), as seen; textures add detail around it. */
  c: number;
  r: number;
  /** Wall material: absent = painted render; 1 red brick, 2 yellow brick, 3 stone ashlar. */
  m?: WallMaterial;
  nw?: 1;
  /** Not solid: raised parts and canopies you can drive under. */
  nc?: 1;
  /** Hidden: a hand-built landmark model is drawn here instead (still solid). */
  hd?: 1;
  /** Outline edges (edge i: vertex i → i + 1) that face the street rather than a neighbour. */
  sf?: number[];
  sh?: ShopKind;
  rings: Ring[];
}

export type RoadKind = 'major' | 'minor' | 'service' | 'pedestrian' | 'foot' | 'cycle';

export interface Road {
  k: RoadKind;
  w: number;
  p: number[];
}

export type AreaKind = 'water' | 'green' | 'plaza';

export interface Area {
  k: AreaKind;
  rings: Ring[];
}

export type LandmarkId = 'cathedral' | 'centraal' | 'mas' | 'steen' | 'boerentoren' | 'stadhuis' | 'brabo' | 'langeWapper';

/** Placed at (x, z), turned by angle (rotation.y = -angle); the rest is local: +x along the long side, +z across. */
export interface Landmark {
  id: LandmarkId;
  x: number;
  z: number;
  angle: number;
  length: number;
  width: number;
  height: number;
  ring: Ring;
  parts: { h: number; mh: number; ring: Ring }[];
}

export interface CityData {
  version: 1;
  origin: { lat: number; lon: number };
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  buildings: Building[];
  roads: Road[];
  areas: Area[];
  trams: number[][];
  landmarks: Landmark[];
  /** Flat [x, z, kind, girth] per tree: kind indexes TREE_KINDS (treeKinds.ts), girth is trunk circumference in cm. */
  trees: number[];
  crossings: number[][];
  signs?: Sign[];
  logos?: LogoRect[];
  terraces?: number[]; // café terrace sets: flat [x, z, facing angle, colour index, …]
  velo?: number[]; // flat [x, z, angle of the row of docks, docks, …]
  /** Flat [x, z, …]; signals [x, z, facing angle, …]. */
  props: { lamps: number[]; benches: number[]; bollards: number[]; signals: number[] };
}

export interface GraphEdge {
  a: number;
  b: number;
  p: number[];
  len: number;
  o?: 1;
  s: number; // speed limit (m/s)
  w: number;
  n?: string;
  /** Walk graph: sidewalk offset from the centreline [left, right] looking a → b; 0 = centreline, -1 = no room. */
  sw?: [number, number];
  /** Bike graph: where riders keep to, m right of the centreline. */
  l?: number;
  /** Bike graph: how readily riders turn into it (absent = 1, a quiet street). */
  q?: number;
}

export interface RoadGraph {
  nodes: number[];
  edges: GraphEdge[];
}

export interface TramRun {
  line: string;
  colour: number;
  to: string;
  p: number[];
  len: number;
  stops: number[]; // distances along p (m)
}

/** p is the lane the bus keeps to, not the street's centreline; end = a terminus inside the slice. */
export interface BusRun extends TramRun {
  end?: 1;
}

/** De Lijn trips per hour (index 0–23) on a representative weekday / weekend day, baked from GTFS (tools/map/fetch-gtfs.ts). */
export interface LineSchedule {
  weekday: number[];
  weekend: number[];
}

export interface GraphData {
  version: 1;
  drive: RoadGraph;
  walk: RoadGraph;
  bike?: RoadGraph;
  trams: TramRun[];
  buses: BusRun[];
  schedules?: Record<string, LineSchedule>; // keyed by line number; absent lines fall back to a default service
  hospital: [number, number, number]; // respawn outside ZNA Sint-Elisabeth: x, z, facing (Rapier angle)
}

export type WallMaterial = 1 | 2 | 3;

export type ShopKind = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 shop, 2 café / restaurant, 3 fashion, 4 food, 5 bakery, 6 jewellery, 7 service

export type SignStyle =
  | 'pharmacy' | 'cafe' | 'restaurant' | 'fastfood' | 'bakery' | 'jewelry' | 'fashion' | 'food' | 'bank' | 'service'
  | 'shop' | 'hotel' | 'culture' | 'club' | 'public'
  | 'plate'
  | 'street';

/** [building index, outline edge, position along it 0–1, width (m), style, name, chain colour or null, logo index?] */
export type Sign = [number, number, number, number, SignStyle, string, (number | null)?, number?];

/** Cell of public/map/logos.webp: [x, y, width, height (px), background colour, 1 = emblem the name goes beside]. */
export type LogoRect = [number, number, number, number, number, 0 | 1];
