import { createServer } from 'node:http';
import { RELAY_PATH } from '../src/net/protocol.ts';
import { attachRelay } from './relay.ts';

const port = Number(process.env.PORT ?? 8787);
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ players: relay.players, rooms: relay.rooms.size }));
    return;
  }
  res.writeHead(404).end();
});
const relay = attachRelay(server, { standalone: true });
server.listen(port, () => console.info(`relay listening on :${port} (ws path ${RELAY_PATH})`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    relay.close();
    server.close(() => process.exit(0));
    server.closeAllConnections(); // close() alone waits for requests in progress, even ones never finished sending
  });
}
