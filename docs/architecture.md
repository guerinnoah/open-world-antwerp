# Architecture

The city is generated offline into JSON files ([map pipeline](map-pipeline.md)). The browser turns them into meshes
and physics at load time and simulates traffic, pedestrians and transit locally. The only server is a relay that
passes player positions between games ([multiplayer](multiplayer.md)).

Antwerp is flat, so physics is 2D (Rapier) on the ground plane and rendering is 3D (Three.js).

## Coordinates

Metres, with the origin at the Brabo fountain on the Grote Markt. +x is east, +z is south, +y is up. Rapier's (x, y)
is Three's (x, z).

## How it runs

- `src/main.ts` loads the map, textures and people, builds the scenery, then creates `Game` (passing it the interiors,
  bikes, scooters and motorbikes). Settings, districts and multiplayer attach afterwards with `game.attachX()`.
- The loop steps physics at a fixed rate (60 Hz on the high preset, 30 otherwise) and renders every frame,
  interpolating between steps.
- `src/game/game.ts` owns the simulation. Logic goes in `fixedUpdate`, drawing in `render`. It hands getting in and out of
  vehicles to `boarding.ts`, crashes and knock-downs to `collisions.ts`, and the water to `sinking.ts`.

## Physics

Buildings are static polygons, vehicles are boxes, people are circles. Trams and buses in service are moved
kinematically along their routes; other players are kinematic bodies too.

## Rendering

- Buildings are extruded at load time and merged into 500 m chunks; a shader draws the windows and shopfronts.
- Nearly everything else (trees, props, signs, cars, people) is instanced.
- `src/core/quality.ts` picks a low, medium or high preset from the device. It sets resolution, shadows, draw
  distance and how many cars and people there are.

## Folders

| Folder | Contents |
|---|---|
| `src/world/` | Buildings, roofs, ground, signs, props, interiors, landmark models |
| `src/actors/` | Player, vehicles, traffic, pedestrians, trams, buses, bikes, scooters, motorbikes |
| `src/game/` | `Game` and its parts (boarding, collisions, sinking, parked cars, HUD prompts), the chase camera, GPS routing, the wanted level |
| `src/net/` | Multiplayer client and the shared wire protocol |
| `src/ui/`, `src/audio/` | HUD, minimap, world map, settings; sound and radio |

## Conventions

- Tunables are constants at the top of the file that uses them.
- Every drivable thing is a `Vehicle` (`src/actors/vehicle.ts`) with its own spec.
- Random placement (parked cars, scooters) uses fixed seeds, so every player sees the same city.
- The map file formats are defined in `src/world/cityData.ts`.
- Player settings (graphics, volume, look, keys) are saved in `src/core/settings.ts`. Read keys through `pressed()` and show
  them with `keyLabel()` from `src/core/keys.ts`, never as hard-coded letters, so rebinding and AZERTY labels carry through.
- Load files from `public/map`, `public/people` and `public/textures` through `asset()`. In builds it adds a content hash,
  and `vercel.json` lets browsers cache hashed URLs for a year.
