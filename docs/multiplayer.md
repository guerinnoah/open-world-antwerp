# Multiplayer

Everyone shares one world of up to 100 players. Each game runs its own traffic and pedestrians; the relay
(`server/relay.ts`) only forwards each player's position and actions to the others. Nothing is saved.

## Running locally

`pnpm dev` includes the relay, so two tabs see each other. `pnpm mp` tests two headless players end to end.

Add `?solo` to play offline.

## Protocol

Messages are JSON over a WebSocket, defined in `src/net/protocol.ts` and shared by the client and the relay. When you
change it:

- Bump `PROTOCOL_VERSION`. Old clients are told to reload.
- Only append to `VEHICLE_KINDS`, since kinds are sent by index.
- Redeploy both the relay and the game.

## Deploying

The game is a static site on Vercel. Vercel can't keep WebSockets open, so the relay runs on Railway
(`.railway/railway.ts`) as a single instance.

| Variable | Set on | Purpose |
|---|---|---|
| `VITE_MULTIPLAYER_URL` | Vercel (build time) | Relay address, e.g. `wss://…/net`. Without it the game plays solo |
| `SITE_URL` | Vercel (optional) | Site address for link previews |
| `PORT` | Relay | Port to listen on (default 8787) |
| `TRUST_PROXY` | Relay | `1` when behind a proxy, so per-address limits work |

The relay answers `GET /health` with the player count.
