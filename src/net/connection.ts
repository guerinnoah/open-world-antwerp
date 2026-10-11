import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from './protocol';

export type Status = 'connecting' | 'online' | 'offline' | 'full' | 'outdated';

export interface Identity {
  name: string;
  look: string;
  room?: string;
}

export class Connection {
  onMessage: (msg: ServerMessage) => void = () => {};
  onStatus: (status: Status) => void = () => {};
  id = 0;
  room = '';
  private ws: WebSocket | null = null;
  private retry = 1000;

  constructor(
    private url: string,
    private identity: Identity,
  ) {
    this.connect();
  }

  get online() {
    return this.id > 0 && this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage) {
    if (this.online) this.ws!.send(JSON.stringify(msg));
  }

  private connect() {
    this.onStatus('connecting');
    const ws = (this.ws = new WebSocket(this.url));
    let refused: 'full' | 'version' | null = null;
    ws.onopen = () => {
      const { name, look, room } = this.identity;
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, look, ...(room ? { room } : {}) } satisfies ClientMessage));
    };
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.id = msg.id;
        this.room = msg.room;
        this.retry = 1000;
        this.onStatus('online');
      } else if (msg.t === 'refused') {
        refused = msg.reason;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      this.id = 0;
      this.onStatus(refused === 'version' ? 'outdated' : refused === 'full' ? 'full' : 'offline');
      if (refused === 'version') return;
      window.setTimeout(() => this.connect(), refused ? 30_000 : this.retry);
      this.retry = Math.min(this.retry * 2, 15_000);
    };
  }
}
