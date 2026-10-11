# Development

## Tests

`pnpm test` runs the unit tests in `tests/`. They need no server or network.

## Headless tools

`tools/dev/` has Playwright scripts that play the game and take screenshots into `screenshots/`. Start `pnpm dev`
first, and run `pnpm exec playwright install chromium` once. The most useful ones:

- `pnpm shot`: views of the city from above
- `pnpm drive`: walk to a car and drive it
- `pnpm mp`: two players testing chat and collisions
- `pnpm perf`: frame rate on an emulated, throttled phone
- `pnpm og`: renders the link-preview image `public/og.jpg`

Others run with `pnpm tsx tools/dev/<file>.ts`.

## URL parameters

| Parameter | Effect |
|---|---|
| `?play` | Skip the title screen |
| `?solo` | Play offline |
| `?name=Anna` | Set your player name |
| `?spawn=grotemarkt` | Start at the Grote Markt |
| `?quality=low` | Force a quality preset (`low`, `medium`, `high`) |
| `?stats` | Show FPS and draw calls |
| `?fly` | Free camera over the city, no game |
| `?mp` | Join multiplayer from a headless browser or `pnpm preview` |

## Performance

Aim for 60 fps on desktop and 30 on a mid-range phone. Use `?stats` and `pnpm perf` to check, and compare before and
after on the same machine.
