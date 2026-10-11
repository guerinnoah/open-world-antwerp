# GTA Antwerp: Plan

A small, fun, open-world driving game set in a real 1:1 slice of Antwerp. Anyone can play it in the
browser with no install and no sign-up. It's built to be shared on LinkedIn.

## Decisions so far

| Area | Decision |
|---|---|
| Platform | Browser: Vite + TypeScript + Three.js, hosted as a static site on Vercel |
| Style | 3D third-person chase camera, fixed golden-hour lighting. **Realistic look (2026-10-09):** CC0 photo textures, PBR materials with sky reflections, ambient occlusion (desktop), street furniture, detailed cars and people |
| Map | Real 1:1 central slice, generated from open data |
| Goal | Fun and simple personal project, not a commercial release. Public URL, playable in seconds, works on phones (LinkedIn traffic is mostly mobile, often inside the LinkedIn in-app browser) |
| Physics | 2D on the ground plane (buildings are solid walls; no jumps/flips in v1), rendered in 3D |
| Tone | No guns, no gore. Cars, chases, comic knockdowns |
| Language | English. Dutch only for proper names (streets, places, landmarks) |
| Title | "GTA Antwerp" is fine for this non-commercial project |

## What "fun and simple" means here

The player clicks the link and is on the street within ~10 seconds. The hook is **driving around the real Antwerp**,
not a crime game. It's a sandbox:

1. Spawn on foot at Centraal Station.
2. Steal any car (parked, or carjack traffic).
3. Drive through real Antwerp streets past recognizable landmarks. The cathedral spire (123 m) is visible from
   everywhere and works as a compass.
4. Drive into the Scheldt: splash, and the car floats. Putter on at a crawl, or get out and swim while it sinks.

**Cut (2026-10-09):** wanted stars, police, Busted, money, missions. Not needed for a few-minutes-long LinkedIn game.
(Radio was cut too, then **added back (2026-10-10)** as live Belgian stations; see below.)

**Decided (2026-10-09): pure sandbox.** No missions, no landmark tour, no score.

Antwerp flavor:
- Trams run on the real lines in their real line colours, and always win collisions.
  **Added (2026-10-10):** walk up to any tram and press E to take the cab: W/S power and brake along the rails,
  Space is the emergency brake, H rings the bell. Another tram, a bus or the end of the track stops you dead. Get out
  and it goes back into service.
  **Fixed (2026-10-10):** trams never pass through anything. Cars and bikes on the rails get shunted aside, while
  trams, buses and pinned cars make them wait. Their look-ahead follows the track round bends. Trees, lamp posts,
  signals and terraces that the data put on a track, and parked cars, are kept off the rails.
  `pnpm tsx tools/dev/tram-overlap.ts` counts any overlaps that remain.
- **Added (2026-10-10):** De Lijn buses run the real bus routes (33 lines, from OpenStreetMap) in the right-hand lane,
  12 m rigid and 18 m articulated, with the line number and destination on the LED display. They stop at the real
  stops, slow for corners, honk when you're in the way and nudge through in the end, and lay over at their terminus
  (Rooseveltplaats, Groenplaats…) until you're out of sight. Press E by one to take it out of service (the driver
  legs it) and drive it anywhere: heavy, slow to stop, turning about its rear axle, and the articulated ones bend at
  the hinge. Get out and it stays parked; other players see it too.
- Drive into the Scheldt or the docks: splash, no Wasted. Whatever you drive floats low and slow (a third of its top
  speed, drifty, weak brakes) and can drive back ashore. Get out and you swim (no punching) while the car you left
  sinks. Other cars that end up in the water sink too, and pedestrians who fall in are gone.
- Street names appear as you drive onto them.
- Cars and vans have a radio (buses and trams don't) that plays real Belgian stations live (Studio Brussel, MNM, Qmusic, Joe, Willy, Radio 1, Radio 2 Antwerpen,
  Klara), straight from the broadcasters' public streams. R or a tap on the station name switches stations.

## Map slice

Roughly 3 × 3.3 km, origin at the Grote Markt. Approximate bbox: lat 51.205 to 51.235, lon 4.385 to 4.428.

- **Contents:** old town, Grote Markt, Groenplaats, Meir, Centraal Station and the diamond district,
  Eilandje (MAS, the docks), the Scheldekaaien and Het Zuid.
- **Edges:** the Scheldt on the west and the docks on the north are natural borders. The east and south use fog plus soft invisible walls.
- **Terrain:** Antwerp is flat, so the ground is a flat plane with no terrain.

### Data sources

| Data | Source | Notes |
|---|---|---|
| Streets, lanes, one-ways, tram lines, water, parks, building footprints | OpenStreetMap via Overpass | ODbL, so the credits need "© OpenStreetMap contributors". Flemish building footprints in OSM are high quality (GRB import) |
| Building heights | [3D GRB](https://www.vlaanderen.be/digitaal-vlaanderen/onze-diensten-en-platformen/basiskaart-vlaanderen-grb/3d-grb) (Digitaal Vlaanderen), fetched by `pnpm map:fetch-grb` via the download.vlaanderen.be order API | LOD1 only: one height per building (≈ ridge height, 2013 LiDAR), no roof shapes. License: Modellicentie Gratis Hergebruik v1.0; credit "Bron: Grootschalig Referentie Bestand Vlaanderen, Digitaal Vlaanderen". Priority: OSM `height` tag > 3D GRB > OSM levels > default |
| Trees | OpenStreetMap (`natural=tree`, `tree_row`) | ~2k trees + 105 rows in the slice |
| Street furniture | OpenStreetMap (crossings, traffic signals, benches, bollards, street lamps) | Only 65 lamps are mapped; the pipeline adds one every 28 m along streets |
| People | [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) avatars + animations (MIT; licence shipped in `public/people/LICENSE.txt`), fetched by `tools/assets/fetch-people.ts`, baked by `pnpm assets:people` (dev server running) | 8 avatars, 3.2k triangles near / 900 far, walk/run/idle baked to bone-matrix textures, skinned per instance on the GPU |
| Surface textures | [Poly Haven](https://polyhaven.com) (CC0), fetched by `pnpm assets:textures` | Brick, plaster, slate, clay tiles, cobbles, asphalt, paving, grass, sandstone; 1024 px colour + 512 px normal maps as WebP (~3.7 MB) |
| Hero landmarks | Hand-built low-poly | Cathedral, Centraal Station, Het Steen, MAS, Boerentoren, Stadhuis, Brabo fountain |
| Cars, characters | CC0 packs (Kenney, Quaternius) | No licensing worries |
| Logos on signs | Wikidata logo image (P154) → Wikimedia Commons, fetched by `pnpm map:fetch-logos` into `data/raw/logos/`, packed by `map:build` into `public/map/logos.webp` | **Decided (2026-10-10), on trademark risk:** logos only for public institutions, museums, theatres and independents, and only freely licensed files (public domain, CC0, CC BY(-SA)). Chains (`brand` tag or in the house-colour list) and offices stay text only. Credits and a no-affiliation notice in `public/map/logos.html`, linked from the in-game credits. To drop a logo, add its Wikidata item to `BLOCKED` in `tools/map/logos.ts` and rerun `map:build`. `?nologos` shows names instead, for the OG image and clip. As of 2026-10-10 only UAntwerpen and AP Hogeschool have one (12 signs) |

## Architecture

```
tools/map/            offline Node pipeline (run once, output committed)
  fetch.ts            Overpass → data/raw/osm.json
  fetch-grb.ts        3D GRB order API → data/raw/grb/
  build.ts            project to local meters → public/map/city.json (later also collision polygons, road graph, minimap)
public/map/city.json  compact footprints + heights, roads, areas, tram lines (~1 MB gzipped)
public/map/graph.json drive graph (one-ways, speed limits, names), sidewalk graph, tram routes + stops (~0.3 MB gzipped)
src/
  main.ts             boot, loading screen, game loop (fixed-step physics, variable render)
  core/               input (keyboard, gamepad, touch), assets, audio, quality presets
  world/              tile streaming, landmarks, water, lighting/fog
  physics/            Rapier 2D wrapper
  actors/             player on foot, vehicles, pedestrians, traffic, trams, police
  systems/            wanted level, money/score, missions, respawn
  ui/                 HUD, minimap, mission text, touch controls, share card, title/credits
  net/                multiplayer: wire protocol, relay connection, snapshot interpolation, remote players
server/               multiplayer relay (Node + ws): rooms of up to 16, forwards each player's state to the others
```

Key technical choices:
- **2D physics on the ground plane, 3D rendering.** The city is flat, so physics runs in Rapier 2D: building footprints are static
  polygons, cars are boxes, people are circles. This is much simpler and faster than 3D physics.
  - The cost: no jumps or flips in v1.
  - Car handling is a custom arcade model (grip, drift, handbrake) on top of that. Feel matters more than realism.
- **WebGL2, not WebGPU.** WebGPU isn't reliably available in in-app mobile browsers.
- **Buildings are extruded at load time** from the compact footprints in `city.json`. That's ~1 MB gzipped instead of
  ~6–8 MB of pre-baked meshes, and extrusion takes ~120 ms on desktop. They're merged into 500 m chunks for culling, and a
  shader draws procedural windows. Cars, pedestrians and trees will be instanced, which keeps draw calls under ~300.
  If phone load times are bad, move extrusion to a Web Worker before considering pre-baking.
- **AI runs on the road graph** from OSM.
  - Traffic follows lanes and one-ways.
  - Trams follow the real tram lines; buses follow the real bus routes, kept to the right-hand lane.
  - Pedestrians walk along sidewalks.
  - Police path to the player through the graph, then steer directly when close.
- **The game is a static deploy; multiplayer needs one small relay.** Vercel Web Analytics shows how many people come
  from the post. A leaderboard would be a later add-on.
- **Multiplayer (2026-10-10): shared players, local city.** Each game simulates its own traffic, pedestrians and trams,
  and is the authority on its own player. The relay (`server/relay.ts`) only forwards each player's state (15 Hz, ~80
  bytes) to the others in their room. Others are shown ~100 ms in the past, interpolated along their velocities, as
  kinematic bodies: your car bounces off theirs, and their car knocks you over. Parked cars are the same in every
  game, so taking one removes it everywhere, and a car someone leaves behind becomes an ordinary parked car for
  everyone. Players join public rooms (`antwerp-1`, `antwerp-2`…) automatically, or a private one with `?room=…`
  (the online pill copies an invite link). Text chat (2026-10-11): T or the 💬 button opens it, and messages show in
  the chat log and in a bubble over the sender's head. Messages are plain text, up to 120 characters, rate-limited by
  the relay (a burst of 5, then one every 2 s). `pnpm dev` hosts the relay itself. For production, run `pnpm server` on
  a host that keeps WebSockets open (Vercel can't), then build with `VITE_MULTIPLAYER_URL=wss://…/net`. Without
  that variable the deployed game plays solo. `?solo` turns multiplayer off, and headless test runs stay solo
  unless `?mp`. `pnpm mp` checks two headless players end to end.

### Budgets (enforced from M1)

| Budget | Target |
|---|---|
| Time to playable | ≤ 10 s on 4G with a mid-range phone |
| Total download | ≤ 15 MB compressed |
| Frame rate | 60 fps on desktop; 30+ fps on a ~3-year-old mid-range phone. Quality presets lower pixel ratio, draw distance and NPC count |

## Milestones

Each milestone ends deployed to a Vercel preview URL and tested on a real phone.

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Map spike.** Pipeline turns OSM + 3D GRB into a city file; free-fly camera | Grote Markt, cathedral and Meir are recognizable. *First teaser screenshot.* (Done locally; phone test + preview deploy pending) |
| **M1** | **Drive.** Arcade car, chase camera, building collisions, on-foot controller, enter/exit cars, keyboard + touch + gamepad | Driving from Centraal to the Scheldt feels good on desktop and phone. (Built and tested headlessly; needs a hands-on feel check on desktop + phone; gamepad untested) |
| **M2** | **Alive.** Traffic, pedestrians, trams on real lines, water (cars float, you swim, others sink) | The city feels inhabited; perf budget holds on phone. (Built and tested headlessly incl. emulated phone; needs a real-phone check) |
| **M3** | **Unmistakably Antwerp.** Hero landmarks (cathedral, Centraal, MAS, Het Steen + Lange Wapper, Boerentoren, Stadhuis + Brabo fountain), Flemish pitched roofs and stepped gables, trees, minimap | Someone from Antwerp recognizes where they are from a screenshot. (Built: 8 landmark models, pitched roofs + old-town stepped gables, 3.2k trees, minimap, opening shot on Centraal; needs your eye + a real-phone perf check — ~1.1M triangles in busy views) |
| **M3.5** | **Realistic look.** Textures + PBR + AO, road markings and zebra crossings, street furniture, profile-modelled cars with turning wheels, human-proportioned people. Google photogrammetry was tried (hybrid, pure and buildings-only) and **dropped (2026-10-10)**: great from a distance, smeared and melted at street level, where the game camera lives; plus per-visit cost and phone performance | Built |
| **M3.6** | **Facade detail.** Shader-drawn windows (frames, glazing bars, sills, lintels, arches, curtains, lit rooms), floor ledges, cornices, plinths, front doors, shopfronts with signs and stocked shelves on real shop/café locations (OSM), 3D wrought-iron balconies and striped café awnings on street-facing walls | Built |
| **M3.7** | **People, cars, trams.** Realistic Rocketbox pedestrians and player (GPU-skinned, two LODs); six Belgian car types with real body shapes; De Lijn Albatros trams (5/7 sections) with LED destination displays | Built |
| **M3.8** | **Real places.** Every named shop, café, restaurant, bank, pharmacy, hotel, museum, theatre, school and office in OSM (3,204) has a sign with its real name on its real facade (chains in their house colours, text only; offices a nameplate by the door); café hanging boards and vertical HOTEL signs with text, pharmacy crosses; 1,077 blue street name plates on corners; shop windows by kind (fashion rails and mannequins, café interiors, supermarket shelves, bakeries, jewellers' cases, pharmacies); 1,121 café terrace sets; 88 Velo bike-share stations with docks and red bikes | Built |
| **M3.9** | **Walk-in places.** A glass door under every place's sign; press E and you step into a room built on the spot inside the real building (fitted exactly to its footprint, clear of the neighbours: 2,890 of 3,200 doors), furnished for what it is — café bar and tables, supermarket aisles and fridges, boutique rails and mannequins, bakery counter, jeweller's cases, pharmacy, bank, salon, hotel lobby, gallery, nightclub, library, office reception — with staff and customers, its name on the back wall, and real window openings onto the live street; door chime, street sounds muffled indoors | Built |
| **M3.10** | **Ride Velo bikes.** Take a bike from any of the 88 real stations (E), ride it (up to ~33 km/h, tight turns, leaning into corners, bell on H), leave it anywhere or ride it back into an empty dock. The rider pedals: a cycling animation baked per avatar with inverse kinematics (feet on the turning pedals, hands on the grips, saddle set to their leg length), since the Rocketbox library has none | Built |
| **M3.11** | **Multiplayer.** Everyone who opens the game drives the same Antwerp: other players walk, drive and ride with name tags and blue minimap arrows, cars collide, carjacked parked cars vanish for everyone, text chat with bubbles over players' heads, invite links put friends in a private room. Tested with two headless players (`pnpm mp`); needs a hosted relay before it's live on the public URL | Built (dev); relay hosting pending |
| **M3.12** | **E-scooters.** ~1,400 shared Lime, Bolt and Voi scooters on the pavements, laid out the same in every game: in twos and threes across the kerb, along the sides of pedestrian streets, the odd one alone at an angle or lying on its side. Take one (E), ride it standing (up to 38 km/h, quicker than a Velo bike; electric whine, bell on H, a lean into corners), leave it anywhere; drive a car into a parked one and it goes over. The rider's standing pose (feet on the deck, hands on the bars) is baked per avatar with inverse kinematics, like the cycling one. Other players see the same scooters, and see you ride one | Built |
| **M3.13** | **Motorbikes.** Street motorbikes (MT-07 class: 0–100 km/h in under 3 s, ~200 km/h) and Vespa-style mopeds ("brommers" tuned to 55 km/h, in Vespa colours), about one vehicle in nine: parked at the kerb among the cars and riding in traffic with their riders. Steal one with E (traffic riders run off), ride it leaning hard into corners, with its own engine note and no radio; crash into something hard enough and you come off. Seated rider poses (feet on the pegs or the floorboard, hands round the grips) baked per avatar like the cycling one. Other players see you ride | Built |
| **M4** | **Ship.** Title screen with controls, sound, OG image + meta for the LinkedIn preview, credits/attribution, real-phone test, final perf pass, deploy | Production URL live; short clip recorded; post published. (**Built (2026-10-11):** title card with the controls, up from the first paint and over the held opening shot until Play, skipped by headless runs unless `?title`, and by `?play`; OG/Twitter meta with absolute URLs from `SITE_URL` or Vercel's production domain (vite.config.ts); `public/og.jpg` rendered by `pnpm og`. Still to do: real-phone test, perf pass, deploy, clip, post) |

## Testing

- **Vitest** for pure logic: projection math, geometry, road graph, vehicle feel.
- **Playwright smoke test:** the page loads, a frame renders, the player can drive forward; screenshots go into the PR.
- **Manual playtests** on a real phone at the end of every milestone, inside the LinkedIn app as well.

## Out of scope for v1

Guns, police/wanted levels, missions, money, saves, leaderboard, interiors, day/night cycle, voice acting,
Linkeroever and the tunnels, the port, and the Ring.
These are all candidates for a v2 if the post lands.

## Top risks

| Risk | Mitigation |
|---|---|
| The city looks generic | Hero landmarks, Antwerp facade styles, the cathedral always on the skyline; judged at the M0 gate |
| Mobile performance / in-app browser quirks | Test on a phone from M1, quality presets, budgets checked every milestone |
| Driving feels floaty or annoying | Arcade model, tuned in M1 before anything else is built on it |
| Scope creep | Anything not in a milestone goes in the v2 list |
