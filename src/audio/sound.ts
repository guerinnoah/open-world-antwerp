import { Radio, STATIONS, type RadioStatus, type Station } from './radio';

const MUTE_KEY = 'gta-antwerp-muted';
const STATION_KEY = 'gta-antwerp-station';
const GEARS = [0, 18, 38, 62, 92, 140]; // km/h where each gear starts
const IDLE_RPM = 850;
const MAX_RPM = 5600;
// Events that count as a user activation. Not pointerdown: a touch pointerdown isn't one, so iOS would stay silent.
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/** localStorage throws when site storage is blocked (cookies off, sandboxed iframe): then nothing is remembered. */
function stored(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return value ?? null;
  }
}

const source = (ctx: AudioContext, buffer: AudioBuffer, loop = false) => {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  return src;
};

function fadeIn(ctx: AudioContext, level: number, seconds: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(level, ctx.currentTime + seconds);
  return g;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private engine: Motor | null = null;
  private engineWanted: MotorKind | null = null;
  private listener = { x: 0, z: 0, yaw: 0 };
  private stopHorn: (() => void) | null = null;
  private lastCrash = 0;
  private radio: Radio | null = null;
  private radioWanted = false;
  private station = Math.min(Number(stored(STATION_KEY) ?? 0) || 0, STATIONS.length);
  muted = stored(MUTE_KEY) === '1';

  constructor() {
    // Browsers only allow audio after a user gesture: start on a key or tap (Radio's iOS unlock needs it too).
    this.awaitGesture(true);
    addEventListener('keydown', (e) => e.code === 'KeyM' && !e.repeat && this.toggleMute());
    addEventListener('keydown', (e) => e.code === 'KeyR' && !e.repeat && this.radioWanted && this.nextStation());
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
      if (this.radioWanted) this.radio?.tune(document.hidden ? null : this.tuned);
    });
  }

  /** Keeps resuming on taps and keys until the context runs: iOS only allows it inside a gesture. */
  private unlock = () => {
    this.start();
    const ctx = this.ctx!;
    if (ctx.state === 'running') this.awaitGesture(false);
    else ctx.resume().catch(() => {});
  };

  private awaitGesture(on: boolean) {
    for (const type of GESTURES) {
      // Capture, so a field that stops propagation (the chat) can't swallow the gesture.
      if (on) addEventListener(type, this.unlock, true);
      else removeEventListener(type, this.unlock, true);
    }
  }

  private start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    // Listen again whenever it stops running (backgrounded, or an iOS interruption) so the next tap resumes it.
    ctx.onstatechange = () => ctx.state !== 'running' && this.awaitGesture(true);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.muffle.connect(this.master).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.ambience();
    if (this.engineWanted) this.engineOn(this.engineWanted);
    this.radio = new Radio(ctx, this.muffle, this.noise, () => this.onRadio?.());
    if (this.radioWanted) this.radio.tune(this.tuned);
    this.onChange?.();
  }

  onChange?: () => void;

  toggleMute() {
    this.muted = !this.muted;
    stored(MUTE_KEY, this.muted ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    this.onChange?.();
  }

  listen(x: number, z: number, yaw: number) {
    this.listener = { x, z, yaw };
  }

  engineOn(kind: MotorKind) {
    this.engineWanted = kind;
    if (!this.ctx || this.engine) return;
    this.engine = kind === 'tram' ? new TramMotor(this.ctx, this.muffle, this.noise)
      : kind === 'scooter' ? new ScooterMotor(this.ctx, this.muffle, this.noise)
      : new Engine(this.ctx, this.muffle, this.noise, ENGINE_PITCH[kind]);
  }

  engineOff() {
    this.engineWanted = null;
    this.engine?.stop();
    this.engine = null;
  }

  engineUpdate(kmh: number, throttle: number, dt: number) {
    this.engine?.update(kmh, throttle, dt);
  }

  onRadio?: () => void;

  get radioState(): { name: string | null; status: RadioStatus } | null {
    if (!this.radioWanted) return null;
    return { name: this.tuned?.name ?? null, status: this.radio?.status ?? 'off' };
  }

  radioOn() {
    this.radioWanted = true;
    this.radio?.tune(this.tuned);
    this.onRadio?.();
  }

  radioOff() {
    this.radioWanted = false;
    this.radio?.tune(null);
    this.onRadio?.();
  }

  nextStation() {
    if (this.radio?.status !== 'blocked') {
      this.station = (this.station + 1) % (STATIONS.length + 1);
      stored(STATION_KEY, String(this.station));
    }
    this.radio?.tune(this.tuned);
    this.onRadio?.();
  }

  private get tuned(): Station | null {
    return STATIONS[this.station] ?? null;
  }

  /** `impact`: the speed lost (m/s). */
  crash(impact: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastCrash < 0.25) return;
    this.lastCrash = ctx.currentTime;
    const vol = Math.min(impact / 12, 1);
    this.noiseBurst({ type: 'lowpass', freq: 500, gain: 0.5 * vol, decay: 0.25 });
    this.tone(55, 0.6 * vol, 0.25);
    if (impact > 6) this.noiseBurst({ type: 'bandpass', freq: 2600, q: 3, gain: 0.25 * vol, decay: 0.35 });
  }

  knock(x: number, z: number, speed: number, metal: boolean) {
    const { gain, pan } = this.place(x, z, 60);
    if (gain <= 0) return;
    const vol = gain * Math.min(0.4 + speed / 20, 1);
    this.noiseBurst({ type: 'lowpass', freq: 600, gain: 0.45 * vol, decay: 0.2, pan });
    if (metal) this.noiseBurst({ type: 'bandpass', freq: 1900, q: 8, gain: 0.35 * vol, decay: 0.5, pan });
    else this.noiseBurst({ type: 'bandpass', freq: 900, q: 2, gain: 0.25 * vol, decay: 0.12, pan });
  }

  bump(x: number, z: number) {
    const { gain, pan } = this.place(x, z, 40);
    if (gain > 0) this.noiseBurst({ type: 'lowpass', freq: 300, gain: 0.35 * gain, decay: 0.15, pan });
  }

  swing(x: number, z: number) {
    const { gain, pan } = this.place(x, z, 20);
    if (gain > 0) this.noiseBurst({ type: 'bandpass', freq: 700, q: 0.8, gain: 0.12 * gain, decay: 0.12, pan });
  }

  punch(x: number, z: number) {
    const { gain, pan } = this.place(x, z, 40);
    if (gain <= 0) return;
    this.noiseBurst({ type: 'bandpass', freq: 1400, q: 1.2, gain: 0.4 * gain, decay: 0.06, pan });
    this.noiseBurst({ type: 'lowpass', freq: 250, gain: 0.45 * gain, decay: 0.14, pan });
  }

  splash(x: number, z: number) {
    const ctx = this.ctx;
    const { gain, pan } = this.place(x, z, 80);
    if (!ctx || gain <= 0) return;
    const src = source(ctx, this.noise);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(1800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(250, ctx.currentTime + 1.1);
    const env = this.envelope(0.6 * gain, 0.02, 1.3);
    src.connect(filter).connect(env).connect(this.panner(pan));
    src.start();
    src.stop(ctx.currentTime + 1.4);
    this.tone(70, 0.4 * gain, 0.4);
  }

  bell(x: number, z: number) {
    const { gain, pan } = this.place(x, z, 150);
    if (gain <= 0) return;
    this.ring({
      notes: [[0, 1040], [0.32, 1040]], partials: [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]],
      peak: 0.12, volume: gain, attack: 0.004, decay: 1.1, damping: 0.3, length: 1.2, out: () => this.panner(pan),
    });
  }

  bikeBell() {
    if (this.ctx) this.bikeRing(1, 0);
  }

  /** Someone else's bike bell, out in the world. */
  bikeBellAt(x: number, z: number) {
    const { gain, pan } = this.place(x, z, 60);
    if (gain > 0) this.bikeRing(gain, pan);
  }

  private bikeRing(volume: number, pan: number) {
    this.ring({
      notes: [[0, 2350], [0.13, 2350]], partials: [[1, 1], [2.32, 0.5], [3.9, 0.25], [5.6, 0.12]],
      peak: 0.1, volume, attack: 0.003, decay: 0.55, damping: 0.25, length: 0.6, out: () => this.panner(pan),
    });
  }

  chime() {
    if (!this.ctx) return;
    this.ring({
      notes: [[0, 1318.5], [0.22, 1046.5]], partials: [[1, 1], [2, 0.25], [3.01, 0.1]],
      peak: 0.09, attack: 0.005, decay: 1.2, length: 1.3, out: () => this.master,
    });
  }

  indoors(on: boolean) {
    if (!this.ctx) return;
    this.muffle.frequency.setTargetAtTime(on ? 1400 : 20000, this.ctx.currentTime, 0.08);
  }

  honk(x: number, z: number) {
    const { gain, pan } = this.place(x, z, 90);
    if (gain > 0) this.hornSound(0.18 * gain, pan, 0.45);
  }

  horn(on: boolean) {
    if (!this.ctx) return; // no audio until the first gesture (a gamepad press isn't one)
    if (on && !this.stopHorn) this.stopHorn = this.hornSound(0.22, 0, Infinity);
    if (!on && this.stopHorn) {
      this.stopHorn();
      this.stopHorn = null;
    }
  }

  private ambience() {
    const ctx = this.ctx!;
    for (const [type, freq, gain] of [['lowpass', 380, 0.07], ['bandpass', 1400, 0.012]] as const) {
      const src = source(ctx, this.noise, true);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(this.muffle);
      src.start();
    }
  }

  private hornSound(volume: number, pan: number, duration: number) {
    const ctx = this.ctx!;
    const gain = fadeIn(ctx, volume, 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.connect(gain).connect(this.panner(pan));
    const oscs = [415, 523].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    const stop = () => {
      const t = ctx.currentTime;
      gain.gain.setTargetAtTime(0, t, 0.02);
      for (const o of oscs) o.stop(t + 0.15);
    };
    if (Number.isFinite(duration)) setTimeout(stop, duration * 1000);
    return stop;
  }

  private ring({ notes, partials, peak, volume = 1, attack, decay, damping = 0, length, out }: {
    notes: number[][]; partials: number[][]; peak: number; volume?: number; attack: number; decay: number; damping?: number; length: number; out: () => AudioNode;
  }) {
    const ctx = this.ctx!;
    for (const [delay, freq] of notes) {
      for (const [ratio, amp] of partials) {
        const osc = ctx.createOscillator();
        osc.frequency.value = freq * ratio;
        const env = ctx.createGain();
        const t = ctx.currentTime + delay;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(peak * amp * volume, t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + decay / ratio ** damping);
        osc.connect(env).connect(out());
        osc.start(t);
        osc.stop(t + length);
      }
    }
  }

  private noiseBurst({ type, freq, q = 1, gain, decay, pan = 0 }: { type: BiquadFilterType; freq: number; q?: number; gain: number; decay: number; pan?: number }) {
    const ctx = this.ctx!;
    const src = source(ctx, this.noise);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter).connect(this.envelope(gain, 0.004, decay)).connect(this.panner(pan));
    src.start(ctx.currentTime, Math.random() * 1.5);
    src.stop(ctx.currentTime + decay + 0.1);
  }

  private tone(freq: number, gain: number, decay: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(this.envelope(gain, 0.005, decay));
    osc.start();
    osc.stop(ctx.currentTime + decay + 0.1);
  }

  private envelope(peak: number, attack: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.muffle);
    return g;
  }

  private panner(pan: number): AudioNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.muffle);
    return p;
  }

  private place(x: number, z: number, range: number): { gain: number; pan: number } {
    if (!this.ctx) return { gain: 0, pan: 0 };
    const dx = x - this.listener.x, dz = z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = Math.max(0, 1 - d / range) ** 2;
    const pan = d > 0.1 ? ((-dx * Math.sin(this.listener.yaw) + dz * Math.cos(this.listener.yaw)) / d) * 0.8 : 0;
    return { gain, pan };
  }
}

type MotorKind = 'car' | 'bus' | 'tram' | 'scooter' | 'motorbike' | 'moped';

const ENGINE_PITCH: Partial<Record<MotorKind, number>> = { bus: 0.45, motorbike: 1.6, moped: 2.6 };

interface Motor {
  update(kmh: number, throttle: number, dt: number): void;
  stop(): void;
}

function oscillators(ctx: AudioContext, out: AudioNode, voices: [OscillatorType, number][]) {
  return voices.map(([type, level]) => {
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    g.gain.value = level;
    o.connect(g).connect(out);
    o.start();
    return o;
  });
}

function stopMotor(ctx: AudioContext, { osc, noise, gain }: { osc: OscillatorNode[]; noise: AudioBufferSourceNode; gain: GainNode }, fade: number, end: number) {
  const t = ctx.currentTime;
  gain.gain.setTargetAtTime(0, t, fade);
  for (const o of osc) o.stop(t + end);
  noise.stop(t + end);
}

class Engine {
  private rpm = IDLE_RPM;
  private nodes: { osc: OscillatorNode[]; noise: AudioBufferSourceNode; band: BiquadFilterNode; filter: BiquadFilterNode; gain: GainNode };

  constructor(private ctx: AudioContext, out: AudioNode, noiseBuffer: AudioBuffer, private pitch = 1) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.5;
    const gain = fadeIn(ctx, 0.16, 0.25);
    filter.connect(gain).connect(out);
    const osc = oscillators(ctx, filter, [['sawtooth', 0.5], ['square', 0.35]]);
    const noise = source(ctx, noiseBuffer, true);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    noise.connect(band).connect(ng).connect(filter);
    noise.start();
    this.nodes = { osc, noise, band, filter, gain };
  }

  update(kmh: number, throttle: number, dt: number) {
    const speed = Math.abs(kmh);
    let target: number;
    if (speed < 3) {
      target = IDLE_RPM + Math.abs(throttle) * 2600;
    } else {
      const g = Math.max(0, GEARS.findIndex((v, i) => speed < (GEARS[i + 1] ?? Infinity) && speed >= v));
      const lo = GEARS[g], hi = GEARS[g + 1] ?? 160;
      target = IDLE_RPM + 1200 + ((speed - lo) / (hi - lo)) * (MAX_RPM - IDLE_RPM - 1200);
    }
    this.rpm += (target - this.rpm) * Math.min(1, dt * 7);
    const f = (this.rpm / 30) * this.pitch;
    const t = this.ctx.currentTime;
    const { osc, band, filter, gain } = this.nodes;
    osc[0].frequency.setTargetAtTime(f, t, 0.03);
    osc[1].frequency.setTargetAtTime(f / 2, t, 0.03);
    band.frequency.setTargetAtTime(f * 2.5, t, 0.03);
    const load = Math.abs(throttle);
    filter.frequency.setTargetAtTime(350 + load * 1300 + this.rpm * 0.12, t, 0.05);
    gain.gain.setTargetAtTime(0.11 + load * 0.12, t, 0.08);
  }

  stop() {
    stopMotor(this.ctx, this.nodes, 0.08, 0.5);
  }
}

class TramMotor {
  private nodes: { osc: OscillatorNode[]; tone: GainNode; noise: AudioBufferSourceNode; rails: BiquadFilterNode; rumble: GainNode; gain: GainNode };

  constructor(private ctx: AudioContext, out: AudioNode, noiseBuffer: AudioBuffer) {
    const gain = fadeIn(ctx, 1, 0.4);
    gain.connect(out);
    const tone = ctx.createGain();
    tone.gain.value = 0;
    tone.connect(gain);
    const osc = oscillators(ctx, tone, [['triangle', 1], ['sine', 0.7]]);
    const noise = source(ctx, noiseBuffer, true);
    const rails = ctx.createBiquadFilter();
    rails.type = 'lowpass';
    rails.Q.value = 0.7;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    noise.connect(rails).connect(rumble).connect(gain);
    noise.start();
    this.nodes = { osc, tone, noise, rails, rumble, gain };
  }

  update(kmh: number, throttle: number) {
    const speed = Math.abs(kmh);
    const t = this.ctx.currentTime;
    const { osc, tone, rails, rumble } = this.nodes;
    osc[0].frequency.setTargetAtTime(220 + speed * 24, t, 0.05);
    osc[1].frequency.setTargetAtTime(55 + speed * 3, t, 0.05);
    const load = Math.abs(throttle) * Math.min(0.3 + speed / 15, 1);
    tone.gain.setTargetAtTime(0.012 + load * 0.045, t, 0.1);
    rails.frequency.setTargetAtTime(160 + speed * 9, t, 0.1);
    rumble.gain.setTargetAtTime(Math.min(speed / 45, 1) * 0.3, t, 0.15);
  }

  stop() {
    stopMotor(this.ctx, this.nodes, 0.1, 0.6);
  }
}

class ScooterMotor {
  private nodes: { osc: OscillatorNode[]; tone: GainNode; noise: AudioBufferSourceNode; road: BiquadFilterNode; rattle: GainNode; gain: GainNode };

  constructor(private ctx: AudioContext, out: AudioNode, noiseBuffer: AudioBuffer) {
    const gain = fadeIn(ctx, 1, 0.3);
    gain.connect(out);
    const tone = ctx.createGain();
    tone.gain.value = 0;
    tone.connect(gain);
    const osc = oscillators(ctx, tone, [['sine', 1], ['triangle', 0.35]]);
    const noise = source(ctx, noiseBuffer, true);
    const road = ctx.createBiquadFilter();
    road.type = 'bandpass';
    road.Q.value = 0.9;
    const rattle = ctx.createGain();
    rattle.gain.value = 0;
    noise.connect(road).connect(rattle).connect(gain);
    noise.start();
    this.nodes = { osc, tone, noise, road, rattle, gain };
  }

  update(kmh: number, throttle: number) {
    const speed = Math.abs(kmh);
    const t = this.ctx.currentTime;
    const { osc, tone, road, rattle } = this.nodes;
    const whine = 170 + speed * 42;
    osc[0].frequency.setTargetAtTime(whine, t, 0.05);
    osc[1].frequency.setTargetAtTime(whine * 1.5, t, 0.05);
    const load = Math.max(0, throttle) * Math.min(0.4 + speed / 10, 1);
    tone.gain.setTargetAtTime(0.006 + load * 0.03, t, 0.08);
    road.frequency.setTargetAtTime(500 + speed * 60, t, 0.1);
    rattle.gain.setTargetAtTime(Math.min(speed / 20, 1) * 0.1, t, 0.1);
  }

  stop() {
    stopMotor(this.ctx, this.nodes, 0.08, 0.5);
  }
}
