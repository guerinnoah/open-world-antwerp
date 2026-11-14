# Traffic

Cars, pedestrians and cyclists follow three graphs that `tools/map/graph.ts` builds from OpenStreetMap ways into
`public/map/graph.json`: `drive`, `walk` and `bike`. An edge is a polyline between two junctions with a length, a speed,
a width and, where they apply, one-way (`o`) and the street name (`n`). `src/world/navGraph.ts` answers "nearest edge"
and "ways out of this junction".

Actors only exist near the player: each system spawns them in a ring just out of sight and removes those that drift too
far (`SPAWN_MIN`, `SPAWN_MAX` and `DESPAWN` at the top of each file). How many there are depends on the quality preset
(`src/core/quality.ts`), not on the time of day.

## Cars

`src/actors/traffic.ts`. Cars have no destination: at each junction they pick a way out at random, weighted towards
going straight on (`extend`). They keep to a lane right of the centreline on two-way streets (`TWO_WAY_LANE`), drive at
the speed limit times a small per-driver factor, and slow for bends. A box probe ahead (`obstacleAhead`) keeps the gap.
When two cars wait on each other, a siren goes first, then the older car; a car stuck too long pushes through. Traffic
pulls over for sirens (`sirenComing`).

Cars and buses stop at red lights. `src/world/signals.ts` turns the OSM signal poles into fixed-time lights: poles
are grouped by the drive-graph junction they stand at, which gives its two road axes green in turn, and traffic stops
at a line just short of the junction. Lights run on the wall clock, so every player sees the same ones. A car queued
behind one that waits for a light waits too, rather than counting as stuck.

Speed limits are OSM's `maxspeed`, or a default per road class where it's missing (`DEFAULT_KMH` in `graph.ts`).

## Pedestrians

`src/actors/pedestrians.ts`. People walk on pavements placed by casting rays from each street to the nearest walls
(`sidewalks` in `graph.ts`). Wider streets and streets near the centre get more people. They change sides only over a
mapped zebra crossing near a junction (`zebraAcross`), and at traffic lights they wait for the cars to get red. Hit by
a vehicle, they fall over and stop colliding with cars until they get up.

## Cyclists

`src/actors/cyclists.ts`. Riders use the bike graph, which includes contraflow streets and only those footpaths signed
for bikes. Each edge has a preference (`q`, from `bikePreference` in `graph.ts`) that favours cycleways and cycle
streets, and a riding line (`l`) that keeps clear of parked cars.
