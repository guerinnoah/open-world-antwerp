# Open World Antwerp

An open-world driving sandbox in a real 1:1 slice of central Antwerp, playable in the browser. Drive a car, tram or
bus, ride a Velo bike or e-scooter, walk into shops, or drive into the Scheldt. Take someone's car in front of the
police and they'll chase you: get out of sight to lose them. Everyone online shares the same city. No guns, no missions.

Built with Vite, TypeScript, Three.js and Rapier 2D, plus a small WebSocket relay for multiplayer.

## Quick start

Needs Node 24 and pnpm 11.

```sh
pnpm install
pnpm dev      # http://localhost:5173
```

The map and assets are committed under `public/`, so this is all you need. Open a second tab to test multiplayer.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move, drive | WASD or arrows | Joystick |
| Get in or out | E | E |
| Handbrake | Space | Handbrake |
| Sprint on foot, go faster in a vehicle | Shift | Push the joystick to the edge |
| Punch, or next radio station in a car | R | Punch, or tap the station |
| Horn or bell | H | |
| Siren (emergency vehicles) | Q | Siren |
| Map and waypoints | P | Tap the minimap |
| Chat | T | 💬 |
| Look around | Drag the mouse | Swipe |
| First / third person | V | 👁 |

Gamepads work too.

## Scripts

- `pnpm dev`: dev server, with the multiplayer relay built in
- `pnpm build`: type-check and build the static site into `dist/`
- `pnpm test`: unit tests
- `pnpm server`: the standalone multiplayer relay

## Docs

- [Architecture](docs/architecture.md): how the game fits together
- [Map pipeline](docs/map-pipeline.md): rebuilding the city from open data
- [Multiplayer](docs/multiplayer.md): the relay and deployment
- [Development](docs/development.md): tests, headless tools, URL parameters

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the
  [ODbL](https://opendatacommons.org/licenses/odbl/)
- Building heights: Bron: Grootschalig Referentie Bestand Vlaanderen, Digitaal Vlaanderen
  ([3D GRB](https://www.vlaanderen.be/digitaal-vlaanderen/onze-diensten-en-platformen/basiskaart-vlaanderen-grb/3d-grb),
  Modellicentie Gratis Hergebruik v1.0)
- People: [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) (MIT, see `public/people/LICENSE.txt`)
- Textures: [Poly Haven](https://polyhaven.com) (CC0)
- Logos: Wikimedia Commons, credited in `public/map/logos.html`
- Radio: the public live streams of VRT and DPG Media

Not affiliated with any brand shown in the game.
