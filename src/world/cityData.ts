// public/map/city.json and graph.json (tools/map/build.ts); metres, +x = east, +z = south.
/** Flat [x0, z0, x1, z1, …], open (last ≠ first). */
type Ring = number[];

export interface Building {
  h: number; // roof height (m)
  mh?: number; // wall base (m)
  /** Wall and pitched-roof colour (sRGB). */
  c: number;
  r: number;
  /** Absent = render; 1 red brick, 2 yellow brick, 3 ashlar. */
  m?: WallMaterial;
  nw?: 1;
  /** Not solid: canopies, raised parts. */
  nc?: 1;
  /** Hidden behind a landmark model (still solid). */
  hd?: 1;
  /** Street-facing outline edges (edge i: vertex i → i + 1). */
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

/** rotation.y = -angle; the rest is local: +x along the long side, +z across. */
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
  /** Flat [x, z, TREE_KINDS index, trunk girth (cm), …]. */
  trees: number[];
  crossings: number[][];
  signs?: Sign[];
  logos?: LogoRect[];
  terraces?: number[]; // flat [x, z, facing angle, colour index, …]
  velo?: number[]; // flat [x, z, row angle, docks, …]
  /** Flat [x, z, …]; signals [x, z, facing angle, …]. */
  props: { lamps: number[]; benches: number[]; bollards: number[]; signals: number[] };
}

export interface GraphEdge {
  a: number;
  b: number;
  p: number[];
  len: number;
  o?: 1;
  s: number; // m/s
  w: number;
  n?: string;
  /** Walk: sidewalk offsets [left, right] looking a → b; 0 = centreline, -1 = none. */
  sw?: [number, number];
  /** Bike: riding line, m right of the centreline. */
  l?: number;
  /** Bike: turn-in preference (absent = 1, a quiet street). */
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
  stops: number[]; // m along p
}

/** p: the bus's lane, not the centreline; end: terminus inside the slice. */
export interface BusRun extends TramRun {
  end?: 1;
}

/** De Lijn trips per hour 0–23, from GTFS (tools/map/fetch-gtfs.ts). */
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
  schedules?: Record<string, LineSchedule>;
  hospital: [number, number, number]; // ZNA Sint-Elisabeth: x, z, facing (Rapier angle)
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

/** Cell of public/map/logos.webp: [x, y, w, h (px), background, 1 = emblem beside the name]. */
export type LogoRect = [number, number, number, number, number, 0 | 1];
