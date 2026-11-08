import { Multiplayer } from '../src/net/multiplayer';
import { createServer, type Server } from 'node:http';
import { connect as tcp, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { safeChat, safeName } from '../server/profanity';
import { attachRelay, type Relay } from '../server/relay';
import {
  CHAT_BURST, CHAT_EVERY, CHAT_MAX, ChatLimit, FLAG, PROTOCOL_VERSION, cleanChat, cleanName, decodeState,
  encodeState, type PlayerState, type ServerMessage,
} from '../src/net/protocol';
import { DELAY, Timeline } from '../src/net/timeline';

const state = (over: Partial<PlayerState> = {}): PlayerState => ({
  time: 1000, mode: 0, x: 0, z: 0, angle: 0, vx: 0, vz: 0, spin: 0, kind: -1, colour: 0, steer: 0, throttle: 0, sink: 0, flags: 0, ...over,
});

describe('protocol', () => {
  it('round-trips a state through the wire format', () => {
    const s = state({ mode: 1, x: 123.456, z: -42.1, angle: 1.2345, vx: 12.345, kind: 3, colour: 0x8a1a1d, steer: -0.5, throttle: 1 });
    const back = decodeState(JSON.parse(JSON.stringify(encodeState(s))))!;
    expect(back.x).toBeCloseTo(123.46, 2);
    expect(back.angle).toBeCloseTo(1.235, 3);
    expect(back).toMatchObject({ mode: 1, kind: 3, colour: 0x8a1a1d, steer: -0.5, throttle: 1 });
  });

  it('rejects malformed states', () => {
    const good = encodeState(state());
    expect(decodeState(good)).not.toBeNull();
    expect(decodeState(good.slice(1))).toBeNull();
    expect(decodeState([...good.slice(0, 2), 'x', ...good.slice(3)])).toBeNull();
    expect(decodeState(good.map((v, i) => (i === 2 ? 1e9 : v)))).toBeNull();
    expect(decodeState(good.map((v, i) => (i === 1 ? 1 : v)))).toBeNull();
    expect(decodeState(good.map((v, i) => (i === 9 ? -1 : v)))).toBeNull();
    expect(decodeState({ length: 14 })).toBeNull();
  });

  it('cleans chat messages', () => {
    expect(cleanChat('  hi\u0000   there\n<3 ')).toBe('hi there <3');
    expect(cleanChat(' \t ')).toBe('');
    expect(cleanChat(7)).toBe('');
    const long = cleanChat('🚲'.repeat(CHAT_MAX + 10));
    expect([...long]).toHaveLength(CHAT_MAX);
    expect(long.endsWith('🚲')).toBe(true);
  });

  it('masks swearing in chat', () => {
    expect(safeChat('what the FUCK')).toBe('what the ****');
    expect(safeChat('fuuuuck, b1tch')).toBe('****, *****');
  });

  it('leaves ordinary words and Antwerp names alone', () => {
    const fine = 'cockpit Scunthorpe Pakistan assassin Niger Kattendijkdok Schijnpoort Kipdorp Player 188';
    expect(safeChat(fine)).toBe(fine);
    expect(safeName('Niger Delta')).toBe('Niger Delta');
  });

  it('limits chat to a burst, then one message every CHAT_EVERY ms', () => {
    const limit = new ChatLimit();
    for (let i = 0; i < CHAT_BURST; i++) expect(limit.take(1000)).toBe(true);
    expect(limit.take(1000)).toBe(false);
    expect(limit.take(1000 + CHAT_EVERY / 2)).toBe(false);
    expect(limit.take(1000 + CHAT_EVERY)).toBe(true);
    expect(limit.take(1000 + CHAT_EVERY)).toBe(false);
  });

  it('cleans names', () => {
    expect(cleanName('  Noah \u0000<b>  ')).toBe('Noah b');
    expect(cleanName('a'.repeat(40))).toHaveLength(16);
    expect(cleanName(42)).toBe('');
  });

  it('refuses offensive names', () => {
    expect(safeName('xXfuckXx')).toBe('');
    expect(safeName('fu ck')).toBe('');
    expect(cleanName('xXfuckXx')).toBe('xXfuckXx'); // the game leaves filtering to the relay
  });
});

describe('local state', () => {
  const flags = (host: object) => (Multiplayer.prototype as unknown as { localState(this: { host: object }, time: number): { flags: number } }).localState.call({ host }, 0).flags;
  const player = { x: 0, z: 0, heading: 0, sink: 0, down: 0, body: { linvel: () => ({ x: 0, y: 0 }) } };

  it('hides players indoors and in trams, not in first person', () => {
    expect(flags({ driving: null, tram: null, player, indoors: false, honking: false }) & FLAG.INDOORS).toBe(0);
    expect(flags({ driving: null, tram: {}, player, indoors: false, honking: false }) & FLAG.INDOORS).toBe(FLAG.INDOORS);
    expect(flags({ driving: null, tram: null, player, indoors: true, honking: false }) & FLAG.INDOORS).toBe(FLAG.INDOORS);
  });
});

describe('timeline', () => {
  const offset = 5000 + 30;
  const filled = (states: PlayerState[]) => {
    const t = new Timeline();
    for (const s of states) t.push(s, s.time + offset);
    return t;
  };

  it('shows the player DELAY behind the newest state, between the two around it', () => {
    const t = filled([state({ time: 1000, x: 0, vx: 10 }), state({ time: 1100, x: 1, vx: 10 }), state({ time: 1200, x: 2, vx: 10 })]);
    const out = state();
    t.sample(1150 + offset + DELAY, out);
    expect(out.x).toBeCloseTo(1.5, 5);
    expect(out.vx).toBeCloseTo(10, 5);
  });

  it('follows the curve through velocities rather than cutting the corner', () => {
    const t = filled([state({ time: 1000, x: 0, z: 0, vx: 10 }), state({ time: 1200, x: 1.5, z: 1.5, vz: 10 })]);
    const out = state();
    t.sample(1100 + offset + DELAY, out);
    expect(out.x).toBeGreaterThan(0.75 + 0.2);
    expect(out.z).toBeLessThan(0.75 - 0.2);
  });

  it('turns the short way round across ±π', () => {
    const t = filled([state({ time: 1000, angle: 3.1 }), state({ time: 1100, angle: -3.1 })]);
    const out = state();
    t.sample(1050 + offset + DELAY, out);
    expect(Math.abs(out.angle)).toBeGreaterThan(3.1);
  });

  it('carries on along the last velocity briefly when states stop, then waits', () => {
    const t = filled([state({ time: 1000, x: 0, vx: 10 }), state({ time: 1100, x: 1, vx: 10 })]);
    const out = state();
    t.sample(1200 + offset + DELAY, out);
    expect(out.x).toBeCloseTo(2, 5);
    t.sample(5000 + offset + DELAY, out);
    expect(out.x).toBeCloseTo(3.5, 5); // extrapolation is capped at 250 ms
  });

  it("jumps instead of gliding across a teleport or a change of mode", () => {
    const t = filled([state({ time: 1000, x: 0 }), state({ time: 1100, x: 500 })]);
    const out = state();
    t.sample(1090 + offset + DELAY, out);
    expect(out.x).toBe(0);
    t.sample(1100 + offset + DELAY, out);
    expect(out.x).toBe(500);
  });

  it('ignores stale states', () => {
    const t = filled([state({ time: 1000, x: 0 }), state({ time: 1100, x: 1 })]);
    t.push(state({ time: 1050, x: 99 }), 1050 + offset);
    expect(t.latest!.x).toBe(1);
  });
});

describe('relay', () => {
  let server: Server;
  let relay: Relay;
  let url: string;
  const sockets: WebSocket[] = [];
  const raws: Socket[] = [];

  const start = async (options?: Parameters<typeof attachRelay>[1]) => {
    server = createServer();
    relay = attachRelay(server, options);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/net`;
  };

  const connect = async (hello: Record<string, unknown> = {}, headers?: Record<string, string>) => {
    const ws = new WebSocket(url, { headers });
    sockets.push(ws);
    const inbox: ServerMessage[] = [];
    const waiters: [string, (m: ServerMessage) => void][] = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      const i = waiters.findIndex(([t]) => t === msg.t);
      if (i >= 0) waiters.splice(i, 1)[0][1](msg);
      else inbox.push(msg);
    });
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    const next = <T extends ServerMessage['t']>(t: T) =>
      new Promise<Extract<ServerMessage, { t: T }>>((resolve) => {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) resolve(inbox.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>);
        else waiters.push([t, resolve as (m: ServerMessage) => void]);
      });
    const send = (msg: unknown) => ws.send(JSON.stringify(msg));
    send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Tester', look: 'Male_Adult_01', ...hello });
    return { ws, next, send, inbox };
  };

  // hand-written handshake, for requests the ws client won't make
  const raw = (target: string) => {
    const socket = tcp((server.address() as AddressInfo).port, '127.0.0.1');
    raws.push(socket);
    socket.on('error', () => {});
    socket.write(
      `GET ${target} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
    );
    const reply = new Promise<string>((resolve) => socket.once('data', (data) => resolve(data.toString())));
    const closed = new Promise((resolve) => socket.on('close', resolve));
    return { socket, reply, closed };
  };

  const until = async (test: () => boolean) => {
    while (!test()) await new Promise((resolve) => setTimeout(resolve, 10));
  };

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const socket of raws.splice(0)) socket.destroy();
    relay.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('puts everyone in one world and relays their states to the others only', async () => {
    await start();
    const a = await connect({ name: 'Anna' });
    const welcomeA = await a.next('welcome');
    expect(welcomeA.peers).toEqual([]);

    const b = await connect({ name: 'Bram' });
    const welcomeB = await b.next('welcome');
    expect(welcomeB.peers.map((p) => p.name)).toEqual(['Anna']);
    expect((await a.next('join')).peer.name).toBe('Bram');

    const s = encodeState(state({ x: 10, z: 20 }));
    a.send({ t: 's', s });
    const got = await b.next('s');
    expect(got).toEqual({ t: 's', id: welcomeA.id, s });
    const c = await connect();
    const welcomeC = await c.next('welcome');
    expect(welcomeC.peers.find((p) => p.id === welcomeA.id)?.state).toEqual(s);

    b.ws.close();
    expect((await a.next('leave')).id).toBe(welcomeB.id);
    expect(a.inbox.some((m) => m.t === 's')).toBe(false);
  });

  it('drops malformed states instead of relaying them', async () => {
    await start();
    const a = await connect();
    await a.next('welcome');
    const b = await connect();
    await b.next('welcome');
    a.send({ t: 's', s: [1, 2, 3] });
    a.send({ t: 's', s: encodeState(state({ x: 1e9 })) });
    a.ws.send('not json');
    const good = encodeState(state({ x: 5 }));
    a.send({ t: 's', s: good });
    expect((await b.next('s')).s).toEqual(good);
  });

  it('ignores the room an older game asks for, and turns players away once the world is full', async () => {
    await start({ maxPlayers: 2 });
    const a = await connect({ name: 'Anna' });
    await a.next('welcome');
    const b = await connect({ room: 'friends' });
    expect((await b.next('welcome')).peers.map((p) => p.name)).toEqual(['Anna']);
    expect(await (await connect()).next('refused')).toEqual({ t: 'refused', reason: 'full' });
  });

  it('sends states between far-apart players once a second, and getting in or out at once', async () => {
    await start();
    const a = await connect();
    const idA = (await a.next('welcome')).id;
    const near = await connect();
    await near.next('welcome');
    const far = await connect();
    await far.next('welcome');
    for (const [c, x] of [[near, 10], [far, 1000]] as const) {
      c.send({ t: 's', s: encodeState(state({ x })) });
      c.send({ t: 'chat', text: 'here' });
      await a.next('chat');
    }
    const times = (c: typeof a) => c.inbox.flatMap((m) => (m.t === 's' && m.id === idA ? [m.s[0]] : []));
    const synced = (text: string) => {
      a.send({ t: 'chat', text });
      return Promise.all([near, far].map((c) => until(() => c.inbox.some((m) => m.t === 'chat' && m.text === text))));
    };

    for (const time of [1000, 1100, 1200]) a.send({ t: 's', s: encodeState(state({ time })) });
    for (const time of [1300, 1400]) a.send({ t: 's', s: encodeState(state({ time, mode: 1, kind: 2 })) });
    await synced('in');
    expect(times(near)).toEqual([1000, 1100, 1200, 1300, 1400]);
    expect(times(far)).toEqual([1000, 1200, 1300]); // 1200: where the car was when it got in

    await new Promise((resolve) => setTimeout(resolve, 1050));
    a.send({ t: 's', s: encodeState(state({ time: 2500, mode: 1, kind: 2 })) });
    await synced('later');
    expect(times(far).at(-1)).toBe(2500);
  });

  it('closes upgrade requests it cannot parse, and in standalone mode ones for other paths', async () => {
    await start({ standalone: true });
    await raw('http://[').closed;
    await raw('/elsewhere').closed;
    await (await connect()).next('welcome');
  });

  it('survives a bad frame from a connection it is refusing for being full', async () => {
    await start({ maxPlayers: 1 });
    await (await connect()).next('welcome');
    const extra = raw('/net');
    expect(await extra.reply).toMatch(/^HTTP\/1.1 101/);
    extra.socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69])); // unmasked: a protocol error
    await extra.closed;
    expect(await (await connect()).next('refused')).toEqual({ t: 'refused', reason: 'full' });
  });

  it('caps connections per address, ignoring X-Forwarded-For unless behind a trusted proxy, and frees them on disconnect', async () => {
    await start({ maxPerAddress: 2, trustProxy: false });
    const a = await connect();
    await connect();
    await expect(connect({}, { 'x-forwarded-for': '203.0.113.9' })).rejects.toThrow('429');
    a.ws.close();
    await until(() => relay.players === 1);
    await (await connect()).next('welcome');
  });

  it('counts players behind a trusted proxy by the first X-Forwarded-For hop', async () => {
    await start({ maxPerAddress: 1, trustProxy: true });
    await connect({}, { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' });
    await connect({}, { 'x-forwarded-for': '203.0.113.2, 10.0.0.1' });
    await expect(connect({}, { 'x-forwarded-for': '203.0.113.1' })).rejects.toThrow('429');
  });

  it('tells late joiners which parked cars were taken', async () => {
    await start();
    const a = await connect();
    await a.next('welcome');
    const watcher = await connect();
    await watcher.next('welcome');
    const red = { kind: 2, colour: 0xff0000 };
    a.send({ t: 'took', x: 10, z: 20, ...red });
    a.send({ t: 's', s: encodeState(state({ mode: 1, x: 30, z: 40, angle: 1.5, ...red })) });
    a.send({ t: 's', s: encodeState(state({ x: 31, z: 40 })) });
    a.send({ t: 'chat', text: 'done' });
    await watcher.next('chat'); // the relay has handled everything before it
    const late = await connect();
    expect((await late.next('welcome')).taken).toEqual([{ x: 10, z: 20, ...red }]);
  });

  it('turns away an out-of-date game', async () => {
    await start();
    const old = await connect({ v: PROTOCOL_VERSION - 1 });
    expect(await old.next('refused')).toEqual({ t: 'refused', reason: 'version' });
  });

  it('relays chat to everyone else, cleaned, and drops spam', async () => {
    await start();
    const a = await connect({ name: 'Anna' });
    const welcomeA = await a.next('welcome');
    const b = await connect({ name: 'Bram' });
    await b.next('welcome');
    a.send({ t: 'chat', text: '  hallo\u0007  Bram! ' });
    expect(await b.next('chat')).toEqual({ t: 'chat', id: welcomeA.id, text: 'hallo Bram!' });
    a.send({ t: 'chat', text: '   ' });
    a.send({ t: 'chat', text: 42 });
    for (let i = 0; i < CHAT_BURST + 5; i++) a.send({ t: 'chat', text: `spam ${i}` });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // the relay allows one more than CHAT_BURST for network timing
    const got = b.inbox.filter((m) => m.t === 'chat');
    expect(got.map((m) => m.t === 'chat' && m.text)).toEqual(Array.from({ length: CHAT_BURST + 1 }, (_, i) => `spam ${i}`));
    expect(a.inbox.some((m) => m.t === 'chat')).toBe(false);
  });

  it('cleans names and gives nameless players one', async () => {
    await start();
    const a = await connect({ name: '<script>' });
    await a.next('welcome');
    const b = await connect({ name: '' });
    const welcome = await b.next('welcome');
    expect(welcome.peers[0].name).toBe('script');
    expect((await a.next('join')).peer.name).toBe(`Player ${welcome.id}`);
  });
});
