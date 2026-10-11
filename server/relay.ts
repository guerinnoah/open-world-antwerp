import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import {
  CHAT_BURST, ChatLimit, MAX_LEFT_BEHIND, MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION, RELAY_PATH, VEHICLE_KINDS, cleanChat, cleanLook, cleanName,
  cleanRoom, decodeState, staysParked, type CarEvent, type ClientMessage, type PeerInfo, type ServerMessage,
} from '../src/net/protocol.ts';

interface Client {
  id: number;
  ws: WebSocket;
  name: string;
  look: string;
  room: Room | null;
  state: number[] | null;
  limit: ChatLimit;
  chat: ChatLimit;
  alive: boolean;
}

interface Room {
  name: string;
  clients: Map<number, Client>;
  cars: CarEvent[];
}

interface UpgradeSource {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

const MAX_CLIENTS = 2000;
const MAX_PER_ADDRESS = 20; // generous: mobile carriers put many players behind one address
const CAR_LOG = 200; // parked-car events a room remembers for late joiners
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
    maxPerRoom = MAX_PLAYERS_PER_ROOM, maxClients = MAX_CLIENTS, maxPerAddress = MAX_PER_ADDRESS, trustProxy = process.env.TRUST_PROXY === '1',
    standalone = false,
  } = {},
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();
  const perAddress = new Map<string, number>();
  let nextId = 1;

  const send = (c: Client, msg: ServerMessage) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const refuse = (c: Client, reason: 'full' | 'version') => {
    send(c, { t: 'refused', reason });
    c.ws.close(reason === 'version' ? 4000 : 4001, reason);
  };
  const broadcast = (room: Room, from: Client, msg: ServerMessage, droppable = false) => {
    const data = JSON.stringify(msg);
    for (const c of room.clients.values()) {
      if (c === from || c.ws.readyState !== WebSocket.OPEN) continue;
      if (droppable && c.ws.bufferedAmount > SLOW_CLIENT) continue;
      c.ws.send(data);
    }
  };
  const info = (c: Client): PeerInfo => ({ id: c.id, name: c.name, look: c.look, ...(c.state ? { state: c.state } : {}) });
  const openRoom = (name: string) => {
    const room: Room = { name, clients: new Map(), cars: [] };
    rooms.set(name, room);
    return room;
  };

  function pickRoom(requested: string): Room | null {
    if (requested) {
      const room = rooms.get(requested);
      if (!room) return openRoom(requested);
      return room.clients.size < maxPerRoom ? room : null;
    }
    for (let n = 1; ; n++) {
      const room = rooms.get(`antwerp-${n}`);
      if (!room) return openRoom(`antwerp-${n}`);
      if (room.clients.size < maxPerRoom) return room;
    }
  }

  function hello(c: Client, msg: Extract<ClientMessage, { t: 'hello' }>) {
    if (msg.v !== PROTOCOL_VERSION) return refuse(c, 'version');
    const room = pickRoom(cleanRoom(msg.room));
    if (!room) return refuse(c, 'full');
    c.name = cleanName(msg.name) || `Player ${c.id}`;
    c.look = cleanLook(msg.look);
    c.room = room;
    send(c, { t: 'welcome', id: c.id, room: room.name, peers: [...room.clients.values()].map(info), cars: room.cars });
    room.clients.set(c.id, c);
    broadcast(room, c, { t: 'join', peer: info(c) });
  }

  function remember(room: Room, event: CarEvent) {
    const cars = room.cars;
    // Games clear away all but the newest MAX_LEFT_BEHIND left-behind cars, so older ones needn't be replayed.
    if (event.t === 'left' && cars.filter((e) => e.t === 'left').length >= MAX_LEFT_BEHIND) cars.splice(cars.findIndex((e) => e.t === 'left'), 1);
    cars.push(event);
    if (cars.length > CAR_LOG) cars.shift();
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
    if (!c.room) {
      if (msg.t === 'hello') hello(c, msg);
      return;
    }
    if (msg.t === 's') {
      const s = decodeState(msg.s);
      if (!s) return;
      const was = c.state && decodeState(c.state);
      // Got out: everyone in the room has that car parked there now (Multiplayer.leaveCar), so late joiners need it too.
      if (was && was.mode === 1 && s.mode === 0 && staysParked(VEHICLE_KINDS[was.kind], was.sink)) {
        remember(c.room, { t: 'left', x: was.x, z: was.z, angle: was.angle, kind: was.kind, colour: was.colour });
      }
      c.state = msg.s;
      broadcast(c.room, c, { t: 's', id: c.id, s: msg.s }, true);
    } else if (msg.t === 'took') {
      const { x, z, kind, colour } = msg;
      if (![x, z, kind, colour].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
      remember(c.room, { t: 'took', x, z, kind, colour });
      broadcast(c.room, c, { t: 'took', id: c.id, x, z, kind, colour });
    } else if (msg.t === 'chat') {
      const text = cleanChat(msg.text);
      if (text && c.chat.take(now)) broadcast(c.room, c, { t: 'chat', id: c.id, text });
    }
  }

  function leave(c: Client) {
    clients.delete(c);
    const room = c.room;
    if (!room) return;
    c.room = null;
    room.clients.delete(c.id);
    if (room.clients.size === 0) rooms.delete(room.name);
    else broadcast(room, c, { t: 'leave', id: c.id });
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
      id: nextId++, ws, name: '', look: '', room: null, state: null, limit: new ChatLimit(BURST, 1000 / RATE),
      // A little over the game's own chat limit, so network jitter never drops a message the game let through.
      chat: new ChatLimit(CHAT_BURST + 2), alive: true,
    };
    if (clients.size >= maxClients) return refuse(c, 'full');
    clients.add(c);
    const timeout = setTimeout(() => c.room || ws.terminate(), HELLO_TIMEOUT);
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
    rooms,
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
