export interface Station {
  name: string;
  url: string;
}

export const STATIONS: Station[] = [
  { name: 'Studio Brussel', url: 'https://quantumcast.vrtcdn.be/stubru/mp3-128' },
  { name: 'MNM', url: 'https://quantumcast.vrtcdn.be/mnm/mp3-128' },
  { name: 'Qmusic', url: 'https://audio-streaming.qmusic.be/qmusic.mp3' },
  { name: 'Joe', url: 'https://audio-streaming.joe.be/joe.mp3' },
  { name: 'Willy', url: 'https://audio-streaming.willy.radio/willy.mp3' },
  { name: 'Radio 1', url: 'https://quantumcast.vrtcdn.be/radio1/mp3-128' },
  { name: 'Radio 2 Antwerpen', url: 'https://quantumcast.vrtcdn.be/ra2ant/mp3-128' },
  { name: 'Klara', url: 'https://quantumcast.vrtcdn.be/klara/mp3-128' },
];

export type RadioStatus = 'off' | 'tuning' | 'on' | 'no signal' | 'blocked';

const VOLUME = 0.45;
const TUNE_TIMEOUT_MS = 10_000;
const SILENCE = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

export class Radio {
  status: RadioStatus = 'off';
  private el = new Audio();
  private gain: GainNode;
  private hiss: GainNode;
  private timeout = 0;

  constructor(private ctx: AudioContext, out: AudioNode, noise: AudioBuffer, private onStatus: () => void) {
    const el = this.el;
    el.crossOrigin = 'anonymous';
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(this.gain).connect(out);

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2500;
    band.Q.value = 0.7;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    src.connect(band).connect(this.hiss).connect(out);
    src.start();

    el.addEventListener('playing', () => this.status === 'tuning' && this.set('on'));
    el.addEventListener('error', () => this.status !== 'off' && this.set('no signal'));

    // iOS starts audio only inside a tap: unlock the element now
    el.src = SILENCE;
    el.play().catch(() => {});
  }

  tune(station: Station | null) {
    clearTimeout(this.timeout);
    const el = this.el;
    if (!station) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      this.set('off');
      return;
    }
    this.set('tuning');
    el.src = station.url;
    el.play().catch((e: DOMException) => {
      if (e.name === 'NotAllowedError') this.set('blocked');
      else if (e.name !== 'AbortError' && this.status === 'tuning') this.set('no signal');
    });
    this.timeout = window.setTimeout(() => this.status === 'tuning' && this.set('no signal'), TUNE_TIMEOUT_MS);
  }

  private set(status: RadioStatus) {
    const t = this.ctx.currentTime;
    this.status = status;
    this.gain.gain.setTargetAtTime(status === 'on' ? VOLUME : 0, t, status === 'on' ? 0.25 : 0.02);
    this.hiss.gain.setTargetAtTime(status === 'tuning' ? 0.05 : 0, t, 0.04);
    this.onStatus();
  }
}
