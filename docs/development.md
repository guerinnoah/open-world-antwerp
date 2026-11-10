# Development

## Tests

`pnpm test` runs the unit tests in `tests/`. They need no server or network.

## Headless tools

`tools/dev/` has Playwright scripts that play the game and take screenshots into `screenshots/`. Start `pnpm dev`
first, and run `pnpm exec playwright install chromium` once. Each has a `pnpm` script; the main ones:

- `pnpm shot`: views of the city from above; `--landmark centraal` circles one landmark, and
  `--vary '|time=22|weather=rain'` repeats each view per query
- `pnpm drive`: walk to a car and drive it
- `pnpm mp`: two players testing chat and collisions
- `pnpm perf`: frame rate on an emulated, throttled phone
- `pnpm og`: renders the link-preview image `public/og.jpg`

## URL parameters

| Parameter | Effect |
|---|---|
| `?play` | Skip the title screen |
| `?title` | Show the title screen in a headless browser, which skips it by default |
| `?solo` | Play offline |
| `?name=Anna` | Set your player name |
| `?spawn=grotemarkt` | Start at the Grote Markt |
| `?quality=low` | Force a quality preset (`low`, `medium`, `high`) |
| `?stats` | Show FPS and draw calls |
| `?fly` | Free camera over the city, no game |
| `?fly&view=MAS` | Start the free camera at one of its named views |
| `?fly&landmark=centraal` | Circle one landmark; `az`, `el` (degrees) and `dist` (m) set the angle |
| `?mp` | Join multiplayer from a headless browser or `pnpm preview` |
| `?time=22` | Force the hour (0–23, Antwerp local) instead of the real clock |
| `?weather=rain` | Force weather: `clear`, `cloudy`, `overcast`, `rain`, `storm` (or `?clouds=0..1&rain=0..1`) |
| `?flat` | Drop the aerial-photo ground colour for the stylised surfaces |
| `?noao` | Turn off ambient occlusion on desktop |
| `?fpv` | Start in first person (toggle any time with `V`) |
| `?wanted=3` | Start with a wanted level (1–5) |

By default the sky follows Antwerp's real sun for the current time and the live weather from Open-Meteo.

## Performance

Aim for 60 fps on desktop and 30 on a mid-range phone. Use `?stats` and `pnpm perf` to check, and compare before and
after on the same machine.
