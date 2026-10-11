import type { Sound } from '../audio/sound';
import { coarsePointer } from '../core/quality';

function button(className: string, onClick: () => void) {
  const b = document.createElement('button');
  b.className = className;
  b.type = 'button';
  b.addEventListener('click', () => {
    onClick();
    b.blur();
  });
  document.body.append(b);
  return b;
}

export class Hud {
  private root = document.createElement('div');
  private speed = document.createElement('div');
  private hint = document.createElement('div');
  private toastEl = document.createElement('div');
  private street = document.createElement('div');
  private fadeEl = document.createElement('div');
  private toastTimer = 0;
  private last = { speed: '', hint: '' };

  constructor() {
    this.root.id = 'hud';
    this.speed.className = 'speed';
    this.hint.className = 'hint';
    this.toastEl.className = 'toast';
    this.street.className = 'street';
    this.speed.hidden = this.hint.hidden = true;
    this.fadeEl.className = 'fade';
    this.root.append(this.speed, this.hint, this.toastEl, this.street, this.fadeEl);
    document.body.append(this.root);
    // A focused <summary> would toggle on the Enter/Space game keys.
    document.querySelector('#credits summary')?.addEventListener('click', (e) => (e.currentTarget as HTMLElement).blur());
  }

  setSpeed(kmh: number | null) {
    const text = kmh === null ? '' : `${Math.round(kmh)}<small> km/h</small>`;
    if (text === this.last.speed) return;
    this.last.speed = text;
    this.speed.innerHTML = text;
    this.speed.hidden = kmh === null;
  }

  setHint(text: string) {
    if (text === this.last.hint) return;
    this.last.hint = text;
    this.hint.textContent = text;
    this.hint.hidden = !text;
  }

  soundToggle(sound: Sound) {
    const b = button('sound', () => sound.toggleMute());
    const refresh = () => {
      b.textContent = sound.muted ? '🔇' : '🔊';
      b.title = sound.muted ? 'Sound off (M)' : 'Sound on (M)';
    };
    sound.onChange = refresh;
    refresh();
  }

  radio(sound: Sound) {
    const bar = document.createElement('div');
    bar.className = 'radio';
    bar.hidden = true;
    const power = button('power', () => sound.toggleRadio());
    power.textContent = '📻';
    const b = button('station', () => sound.nextStation());
    b.title = 'Next station (R)';
    bar.append(power, b);
    document.body.append(bar);
    const touch = coarsePointer();
    sound.onRadio = () => {
      const r = sound.radioState;
      bar.hidden = !r;
      if (!r) return;
      power.classList.toggle('off', !r.name);
      power.title = `Radio ${r.name ? 'off' : 'on'} (Shift+R)`;
      const status = r.status === 'no signal' ? ' · no signal' : r.status === 'blocked' ? (touch ? ' · tap to play' : ' · R to play') : '';
      b.textContent = `${r.name ?? 'Radio off'}${status}${touch ? '' : ' [R]'}`;
      b.classList.toggle('tuning', r.status === 'tuning');
    };
  }

  fade() {
    this.fadeEl.style.opacity = '';
    this.fadeEl.classList.remove('out');
    void this.fadeEl.offsetWidth;
    this.fadeEl.classList.add('out');
  }

  blackout() {
    this.fadeEl.classList.remove('out');
    this.fadeEl.style.opacity = '1';
  }

  setStreet(name: string) {
    this.street.textContent = name;
    this.street.classList.remove('show');
    void this.street.offsetWidth;
    if (name) this.street.classList.add('show');
  }

  toast(text: string, ms = 3500) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
