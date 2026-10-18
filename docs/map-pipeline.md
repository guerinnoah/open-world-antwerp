# Map pipeline

The city is built from open data by the scripts in `tools/map/`. The output in `public/map/` is committed, so you only
run this to change the map.

```sh
pnpm map:fetch         # streets, buildings, trams, shops… from OpenStreetMap
pnpm map:fetch-grb     # building heights from 3D GRB (Digitaal Vlaanderen)
pnpm map:fetch-logos   # logos from Wikidata
pnpm map:fetch-trees   # tree positions, species and girth from Antwerp's open inventory
pnpm map:build         # writes public/map/
```

Downloads go to `data/raw/` (gitignored). No keys are needed. `map:build` still works without the GRB heights, the
logos or the tree inventory (it falls back to OpenStreetMap's sparser tree nodes).

`map:fetch-trees` pulls Antwerp's Groeninventaris "boom" layer for the slice; `map:build` maps each tree's Latin species
(`LATBOOMSOORT`) to a crown type via `src/world/treeKinds.ts` and its trunk girth (`STAMOMTREK`) to a size, packed into
`city.trees` as `[x, z, kind, girth]`.

The map area is set in `tools/map/config.ts`.

## Logos

Only public institutions, museums, theatres and independents get a logo, and only from freely licensed files. Chains
stay text only. To remove a logo, add its Wikidata id to `BLOCKED` in `tools/map/logos.ts` and rerun `map:build`.

## Assets

- **Aerial photo:** `pnpm map:fetch-ortho` tiles the most recent Digitaal Vlaanderen orthophoto over the map area and
  stitches it into `public/map/ortho.webp`. Run it after `map:build`, since it reads the bounds from
  `public/map/city.json`. The game loads it **by default**: the ground layers take their colour from the aerial (sampled
  by world position) while keeping their tiling cobble/asphalt detail, normal maps and shadows — real Antwerp colours up
  close and from above. Load with `?flat` to fall back to the stylised surfaces. Tune `AERIAL_BOOST`/`AERIAL_SAT` in
  `src/world/ground.ts`.
- **Textures:** `pnpm assets:textures` downloads them from Poly Haven into `public/textures/`, with the colour maps also at 512 px (`_512`) for phones.
- **People:** run `pnpm tsx tools/assets/fetch-people.ts`, then `pnpm assets:people` with `pnpm dev` running. This
  writes `public/people/`. Re-bake after changing a bike or scooter frame in `src/actors/*Geometry.ts`, since the
  riding poses are fitted to it.
