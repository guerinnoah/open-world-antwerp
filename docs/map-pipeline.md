# Map pipeline

The city is built from open data by the scripts in `tools/map/`. The output in `public/map/` is committed, so you only
run this to change the map.

```sh
pnpm map:fetch                # streets, buildings, trams, shops… from OpenStreetMap
pnpm map:fetch-grb            # building heights from 3D GRB (Digitaal Vlaanderen)
pnpm map:fetch-logos          # logos from Wikidata
pnpm map:fetch-brand-colours  # house colours for other chains, sampled from their Wikidata logo
pnpm map:fetch-trees          # trees from Antwerp's open inventory
pnpm map:build                # writes public/map/
pnpm map:fetch-gtfs           # De Lijn timetables; reads graph.json, so run map:build again after it
pnpm map:fetch-districts      # neighbourhood outlines, straight to public/map/districts.json
```

Downloads go to `data/raw/` (gitignored). No keys are needed. `map:build` still works without the GRB heights, the
logos, the brand colours or the tree inventory (it falls back to OpenStreetMap's sparser tree nodes).

Trees come from Antwerp's Groeninventaris: species (`LATBOOMSOORT`) map to a crown in `src/world/treeKinds.ts`, trunk
girth (`STAMOMTREK`) to a size.

The map area is set in `tools/map/config.ts`.

## Logos

Signs show a logo only from files Wikimedia Commons marks as public domain or CC0, for chains and independents alike;
offices never get one. De Lijn's logo on trams and buses and NMBS's on the Centraal sign come the same way (`OPERATORS` in
`src/world/cityData.ts`); without them those show the name instead. To remove a logo, add its Wikidata id to `BLOCKED` in
`tools/map/logos.ts` and rerun `map:build`. `?nologos` hides them all in the game.

## Assets

- **Aerial photo:** `pnpm map:fetch-ortho`, run after `map:build`, stitches the latest Digitaal Vlaanderen orthophoto
  into `public/map/ortho.webp`, plus a 2048 px `ortho-2k.webp` for phones. It colours the ground; `?flat` turns it off.
- **Textures:** `pnpm assets:textures` downloads them from Poly Haven into `public/textures/`, with the colour maps also at 512 px (`_512`) for phones.
- **People:** run `pnpm tsx tools/assets/fetch-people.ts`, then `pnpm assets:people` with `pnpm dev` running. This
  writes `public/people/`. Re-bake after changing a bike or scooter frame in `src/actors/*Geometry.ts`, or the chair
  in `src/world/interiors/chairGeometry.ts`, since the riding and sitting poses are fitted to them.
