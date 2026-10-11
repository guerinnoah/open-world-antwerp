# Map pipeline

The city is built from open data by the scripts in `tools/map/`. The output in `public/map/` is committed, so you only
run this to change the map.

```sh
pnpm map:fetch         # streets, buildings, trams, shops… from OpenStreetMap
pnpm map:fetch-grb     # building heights from 3D GRB (Digitaal Vlaanderen)
pnpm map:fetch-logos   # logos from Wikidata
pnpm map:build         # writes public/map/
```

Downloads go to `data/raw/` (gitignored). No keys are needed. `map:build` still works without the GRB heights or the
logos.

The map area is set in `tools/map/config.ts`.

## Logos

Only public institutions, museums, theatres and independents get a logo, and only from freely licensed files. Chains
stay text only. To remove a logo, add its Wikidata id to `BLOCKED` in `tools/map/logos.ts` and rerun `map:build`.

## Assets

- **Textures:** `pnpm assets:textures` downloads them from Poly Haven into `public/textures/`.
- **People:** run `pnpm tsx tools/assets/fetch-people.ts`, then `pnpm assets:people` with `pnpm dev` running. This
  writes `public/people/`. Re-bake after changing a bike or scooter frame in `src/actors/*Geometry.ts`, since the
  riding poses are fitted to it.
