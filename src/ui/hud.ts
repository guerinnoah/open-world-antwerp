import type { Sound } from '../audio/sound';
import { coarsePointer } from '../core/quality';
import { MAX_STARS } from '../game/wanted';

/** Reading offsetWidth forces the reflow that restarts the animation. */
function replay(el: HTMLElement, className: string, on = true) {
  el.classList.remove(className);
  void el.offsetWidth;
  if (on) el.classList.add(className);
}

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
  private district = document.createElement('div');
  private vehicle = document.createElement('div');
  private stars = document.createElement('div');
  private fadeEl = document.createElement('div');
  private health = document.createElement('div');
  private healthBars = [document.createElement('div'), document.createElement('div')]; // the lost chunk lingers behind the fill
  private stamina = document.createElement('div');
  private staminaBar = document.createElement('div');
  private controlsEl = document.createElement('div');
  private lastControls = '';
  private hurtEl = document.createElement('div');
  private wastedEl = document.createElement('div');
  private toastTimer = 0;
  private dead = false;
  private viewBtn: HTMLButtonElement | null = null;
  private last = { speed: '', hint: '', health: -1, stamina: -1, stars: 0 };

  constructor() {
    this.root.id = 'hud';
    this.speed.className = 'speed';
    this.hint.className = 'hint';
    this.toastEl.className = 'toast';
    this.street.className = 'street';
    this.district.className = 'district';
    this.vehicle.className = 'vehicle';
    this.stars.className = 'stars';
    this.stars.hidden = true;
    this.stars.append(...Array.from({ length: MAX_STARS }, () => Object.assign(document.createElement('span'), { textContent: '★' })));
    this.speed.hidden = this.hint.hidden = true;
    this.fadeEl.className = 'fade';
    this.health.className = 'health';
    this.healthBars[0].className = 'lost';
    this.health.append(...this.healthBars);
    this.stamina.className = 'stamina';
    this.stamina.hidden = true;
    this.stamina.append(this.staminaBar);
    this.controlsEl.className = 'controls-list';
    this.controlsEl.hidden = true;
    this.hurtEl.className = 'hurt';
    this.wastedEl.className = 'wasted';
    this.wastedEl.innerHTML = '<span>Wasted</span>';
    this.root.append(this.hurtEl, this.speed, this.hint, this.toastEl, this.street, this.district, this.vehicle, this.stars, this.health, this.stamina, this.controlsEl, this.wastedEl, this.fadeEl);
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
    if (this.dead) text = '';
    if (text === this.last.hint) return;
    this.last.hint = text;
    this.hint.textContent = text;
    this.hint.hidden = !text;
  }

  setHealth(fraction: number) {
    const pct = Math.round(fraction * 200) / 2;
    if (pct === this.last.health) return;
    this.last.health = pct;
    for (const bar of this.healthBars) bar.style.width = `${pct}%`;
    this.health.classList.toggle('low', pct < 25);
  }

  setControls(lines: string[]) {
    const text = lines.join('\n');
    if (text === this.lastControls) return;
    this.lastControls = text;
    this.controlsEl.textContent = text;
    this.controlsEl.hidden = lines.length === 0;
  }

  setStamina(fraction: number) {
    const pct = Math.round(fraction * 200) / 2;
    if (pct === this.last.stamina) return;
    this.last.stamina = pct;
    this.staminaBar.style.width = `${pct}%`;
    this.stamina.hidden = pct > 99.5;
    this.stamina.classList.toggle('low', pct < 20);
  }

  hurt(strength: number) {
    this.hurtEl.style.setProperty('--hurt', String(Math.min(1, 0.3 + strength)));
    replay(this.hurtEl, 'flash');
  }

  /** s until the screen goes black; 0 clears it. */
  wasted(seconds: number, busted = false) {
    this.dead = seconds > 0;
    this.wastedEl.firstElementChild!.textContent = busted ? 'Busted' : 'Wasted';
    this.wastedEl.classList.toggle('busted', busted);
    this.wastedEl.style.setProperty('--wasted', `${seconds}s`);
    this.wastedEl.classList.toggle('show', this.dead);
    document.body.classList.toggle('wasted', this.dead);
    if (this.dead) this.setHint('');
  }

  viewToggle(onClick: () => void) {
    this.viewBtn = button('view', onClick);
  }

  setView(firstPerson: boolean) {
    if (!this.viewBtn) return;
    this.viewBtn.textContent = firstPerson ? '1st' : '3rd';
    this.viewBtn.title = `Switch to ${firstPerson ? 'third' : 'first'} person (V)`;
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
    replay(this.fadeEl, 'out');
  }

  blackout() {
    this.fadeEl.classList.remove('out');
    this.fadeEl.style.opacity = '1';
  }

  setWanted(level: number, searching: boolean) {
    this.stars.classList.toggle('searching', searching);
    if (level === this.last.stars) return;
    if (level > this.last.stars) replay(this.stars, 'up');
    this.last.stars = level;
    this.stars.hidden = !level;
    [...this.stars.children].forEach((s, i) => s.classList.toggle('on', i < level));
  }

  setDistrict(name: string) {
    this.district.textContent = name;
    replay(this.district, 'show', !!name);
  }

  setVehicle(name: string) {
    this.vehicle.textContent = name;
    replay(this.vehicle, 'show', !!name);
  }

  setStreet(name: string) {
    this.street.textContent = name;
    replay(this.street, 'show', !!name);
  }

  toast(text: string, ms = 3500) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
