import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CHAT_BURST, ChatLimit, PROTOCOL_VERSION, RELAY_PATH, cleanLook, decodeState,
  type ClientMessage, type PeerInfo, type ServerMessage, type Took,
} from '../src/net/protocol.ts';
import { safeChat, safeName } from './profanity.ts';

interface Client {
  id: number;
  ws: WebSocket;
  name: string;
  look: string;
  state: number[] | null;
  farAt: number; // ms: when its state last went to far-off players too
  limit: ChatLimit;
  chat: ChatLimit;
  alive: boolean;
}

interface UpgradeSource {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

const MAX_PLAYERS = 100;
const MAX_PER_ADDRESS = 20; // generous: mobile carriers put many players behind one address
const CAR_LOG = 200; // parked cars taken that the world remembers for late joiners
const NEAR = 500; // m: players farther apart get each other's state once a second (FAR_EVERY), enough for the minimap
const FAR_EVERY = 1000;
const HELLO_TIMEOUT = 10_000;
const HEARTBEAT = 15_000;
const RATE = 40; // messages/s per client on average, BURST at once; states alone are 15/s
const BURST = 80;
const SLOW_CLIENT = 256 * 1024; // bytes queued: skip state updates to a client this far behind, the next one catches up

export type Relay = ReturnType<typeof attachRelay>;

/**
 * `standalone`: no other upgrade handler shares the server, so requests for other paths are closed rather than left open.
 * `trustProxy` (TRUST_PROXY=1): count players by the first X-Forwarded-For hop rather than the proxy's own address.
 */
export function attachRelay(
  server: UpgradeSource,
  {
    maxPlayers = MAX_PLAYERS, maxPerAddress = MAX_PER_ADDRESS, trustProxy = process.env.TRUST_PROXY === '1', standalone = false,
  } = {},
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const clients = new Set<Client>();
  const world = new Map<number, Client>(); // those past hello
  const taken: Took[] = [];
  const perAddress = new Map<string, number>();
  let nextId = 1;

  const send = (c: Client, msg: ServerMessage) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const refuse = (c: Client, reason: 'full' | 'version') => {
    send(c, { t: 'refused', reason });
    c.ws.close(reason === 'version' ? 4000 : 4001, reason);
  };
  const broadcast = (from: Client, msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const c of world.values()) if (c !== from && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  };
  const info = (c: Client): PeerInfo => ({ id: c.id, name: c.name, look: c.look, ...(c.state ? { state: c.state } : {}) });

  function relayState(from: Client, s: number[], to: 'all' | 'near' | 'far') {
    const data = JSON.stringify({ t: 's', id: from.id, s } satisfies ServerMessage);
    for (const c of world.values()) {
      if (c === from || c.ws.readyState !== WebSocket.OPEN || c.ws.bufferedAmount > SLOW_CLIENT) continue;
      const far = !!c.state && Math.hypot(c.state[2] - s[2], c.state[3] - s[3]) > NEAR; // [2], [3]: x, z; no position yet counts as near
      if (to === 'all' || far === (to === 'far')) c.ws.send(data);
    }
  }

  function hello(c: Client, msg: Extract<ClientMessage, { t: 'hello' }>) {
    if (msg.v !== PROTOCOL_VERSION) return refuse(c, 'version');
    c.name = safeName(msg.name) || `Player ${c.id}`;
    c.look = cleanLook(msg.look);
    send(c, { t: 'welcome', id: c.id, peers: [...world.values()].map(info), taken });
    world.set(c.id, c);
    broadcast(c, { t: 'join', peer: info(c) });
  }

  function receive(c: Client, raw: string) {
    const now = Date.now();
    if (!c.limit.take(now)) return; // drop, don't disconnect: a burst after a frozen tab is normal

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (!world.has(c.id)) {
      if (msg.t === 'hello') hello(c, msg);
      return;
    }
    if (msg.t === 's') {
      const s = decodeState(msg.s);
      if (!s) return;
      const was = c.state && decodeState(c.state);
      // Getting in or out goes to everyone at once, after the state before it, so far-off games see where it happened.
      const switched = !!was && was.mode !== s.mode;
      if (switched) relayState(c, c.state!, 'far');
      const everyone = switched || now - c.farAt >= FAR_EVERY;
      if (everyone) c.farAt = now;
      c.state = msg.s;
      relayState(c, msg.s, everyone ? 'all' : 'near');
    } else if (msg.t === 'took') {
      const { x, z, kind, colour } = msg;
      if (![x, z, kind, colour].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
      taken.push({ x, z, kind, colour });
      if (taken.length > CAR_LOG) taken.shift();
      broadcast(c, { t: 'took', id: c.id, x, z, kind, colour });
    } else if (msg.t === 'chat') {
      const text = safeChat(msg.text);
      if (text && c.chat.take(now)) broadcast(c, { t: 'chat', id: c.id, text });
    }
  }

  function leave(c: Client) {
    clients.delete(c);
    if (!world.delete(c.id)) return;
    if (world.size === 0) taken.length = 0; // nobody's game has those cars any more: the next to join starts afresh
    else broadcast(c, { t: 'leave', id: c.id });
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // First: a bad frame emits 'error', even on a socket being refused, and an unhandled one would crash the process.
    ws.on('error', () => ws.terminate());
    const address = addressOf(req, trustProxy);
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    ws.on('close', () => {
      const n = perAddress.get(address)! - 1;
      if (n > 0) perAddress.set(address, n);
      else perAddress.delete(address);
    });
    const c: Client = {
      id: nextId++, ws, name: '', look: '', state: null, farAt: 0, limit: new ChatLimit(BURST, 1000 / RATE),
      // A little over the game's own chat limit, so network jitter never drops a message the game let through.
      chat: new ChatLimit(CHAT_BURST + 2), alive: true,
    };
    if (clients.size >= maxPlayers) return refuse(c, 'full');
    clients.add(c);
    const timeout = setTimeout(() => world.has(c.id) || ws.terminate(), HELLO_TIMEOUT);
    ws.on('message', (data, binary) => !binary && receive(c, data.toString()));
    ws.on('pong', () => (c.alive = true));
    ws.on('close', () => {
      clearTimeout(timeout);
      leave(c);
    });
  });

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT);
  heartbeat.unref();

  server.on('upgrade', (req, socket, head) => {
    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://relay').pathname;
    } catch {
      socket.destroy(); // e.g. `GET http://[`: a throw here would crash the process
      return;
    }
    if (path !== RELAY_PATH) {
      if (standalone) socket.destroy(); // nobody else will answer it
      return; // leave Vite's HMR socket alone
    }
    if ((perAddress.get(addressOf(req, trustProxy)) ?? 0) >= maxPerAddress) return deny(socket, '429 Too Many Requests');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return {
    get players() {
      return clients.size;
    },
    close() {
      clearInterval(heartbeat);
      for (const ws of [...wss.clients]) ws.terminate(); // refused ones too, still closing
      wss.close();
    },
  };
}

function addressOf(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined;
  return (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || req.socket.remoteAddress || '';
}

/** Answers an upgrade request without upgrading it. */
function deny(socket: Duplex, status: string) {
  socket.on('error', () => socket.destroy()); // Node stops handling the socket's errors once it's handed to 'upgrade'
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
