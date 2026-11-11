import { pressed, type Action } from './keys';
import { coarsePointer } from './quality';
import { settings } from './settings';

export interface InputState {
  steer: number;
  throttle: number;
  handbrake: boolean;
  sprint: boolean;
  lookX: number;
  lookY: number;
  action: boolean;
  horn: boolean;
  punch: boolean;
  siren: boolean;
  view: boolean; // one-shot
}

export type Seat = 'foot' | 'vehicle' | 'emergency';

const DEADZONE = 0.15;
const dead = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const CLICK_SLOP = 6; // px; less is a punch click, not a look drag

export class Input {
  readonly touch = coarsePointer();
  private keys = new Set<string>();
  private actionQueued = false;
  private punchQueued = false;
  private sirenQueued = false;
  private viewQueued = false;
  private touchRoot: HTMLDivElement | null = null;
  private sirenButton: HTMLButtonElement | null = null;
  private look = { x: 0, y: 0 };
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  private stick: { id: number | null; x: number; y: number; cx: number; cy: number } = { id: null, x: 0, y: 0, cx: 0, cy: 0 };
  private touchHandbrake = false;
  private padActionHeld = false;
  private padPunchHeld = false;
  private padSirenHeld = false;
  private padViewHeld = false;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (pressed('use', e.code)) this.actionQueued = true;
      if (pressed('punch', e.code)) this.punchQueued = true;
      if (pressed('siren', e.code)) this.sirenQueued = true;
      if (pressed('view', e.code)) this.viewQueued = true;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      if (this.drag) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag?.id !== e.pointerId) return;
      const scale = e.pointerType === 'touch' ? 0.008 : 0.005;
      this.look.x += (e.clientX - this.drag.x) * scale;
      this.look.y += (e.clientY - this.drag.y) * scale;
      this.drag.moved += Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    const endDrag = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    canvas.addEventListener('pointerup', (e) => {
      if (this.drag?.id === e.pointerId && e.pointerType === 'mouse' && e.button === 0 && this.drag.moved < CLICK_SLOP) this.punchQueued = true;
      endDrag(e);
    });
    canvas.addEventListener('pointercancel', endDrag);

    if (this.touch) this.createTouchControls();
  }

  sample(): InputState {
    const k = (action: Action) => {
      for (const code of this.keys) if (pressed(action, code)) return true;
      return false;
    };
    let steer = (k('right') ? 1 : 0) - (k('left') ? 1 : 0);
    let throttle = (k('forward') ? 1 : 0) - (k('back') ? 1 : 0);
    let handbrake = k('handbrake');
    let sprint = k('sprint');
    let lookX = this.look.x;
    let lookY = this.look.y;
    let action = this.actionQueued;
    let horn = k('horn');
    let punch = this.punchQueued;
    let siren = this.sirenQueued;
    let view = this.viewQueued;

    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad || pad.mapping !== 'standard') continue;
      // Standard mapping: RT/LT gas/brake, A/RB handbrake (A sprints on foot), Y/B enter/exit, X punch, L3 horn, R3 siren.
      const b = (i: number) => pad.buttons[i]?.value ?? 0;
      steer += dead(pad.axes[0] ?? 0);
      throttle += b(7) - b(6) - dead(pad.axes[1] ?? 0);
      lookX += dead(pad.axes[2] ?? 0) * 0.05;
      lookY += dead(pad.axes[3] ?? 0) * 0.04;
      handbrake ||= b(5) > 0.5 || b(0) > 0.5;
      horn ||= b(10) > 0.5;
      sprint ||= b(0) > 0.5;
      const actionHeld = b(3) > 0.5 || b(1) > 0.5;
      if (actionHeld && !this.padActionHeld) action = true;
      this.padActionHeld = actionHeld;
      const punchHeld = b(2) > 0.5;
      if (punchHeld && !this.padPunchHeld) punch = true;
      this.padPunchHeld = punchHeld;
      const sirenHeld = b(11) > 0.5;
      if (sirenHeld && !this.padSirenHeld) siren = true;
      this.padSirenHeld = sirenHeld;
      const viewHeld = b(12) > 0.5; // d-pad up
      if (viewHeld && !this.padViewHeld) view = true;
      this.padViewHeld = viewHeld;
    }

    if (this.stick.id !== null) {
      steer += this.stick.x;
      throttle -= this.stick.y;
      sprint ||= Math.hypot(this.stick.x, this.stick.y) > 0.95;
    }
    handbrake ||= this.touchHandbrake;

    this.look.x = this.look.y = 0;
    this.actionQueued = this.punchQueued = this.sirenQueued = this.viewQueued = false;
    lookX *= settings.lookSpeed;
    lookY *= settings.lookSpeed * (settings.invertLook ? -1 : 1);
    return { steer: clamp1(steer), throttle: clamp1(throttle), handbrake, sprint, lookX, lookY, action, horn, punch, siren, view };
  }

  set seat(seat: Seat) {
    if (!this.touchRoot || this.touchRoot.dataset.seat === seat) return;
    this.touchRoot.dataset.seat = seat;
    this.sirenButton!.textContent = seat === 'emergency' ? 'Siren' : 'Punch';
    this.touchHandbrake = false; // a hidden button never sees its pointerup
  }

  private createTouchControls() {
    const root = (this.touchRoot = document.createElement('div'));
    root.id = 'touch';
    root.dataset.seat = 'foot';
    root.innerHTML = `
      <div class="stick" aria-hidden="true"><div class="knob"></div></div>
      <button class="btn action" type="button" aria-label="Get in or out">E</button>
      <button class="btn punch" type="button">Punch</button>
      <button class="btn handbrake" type="button">Handbrake</button>`;
    document.body.append(root);

    const stick = root.querySelector<HTMLDivElement>('.stick')!;
    const knob = root.querySelector<HTMLDivElement>('.knob')!;
    const radius = 50;
    const move = (t: Touch) => {
      let dx = t.clientX - this.stick.cx, dy = t.clientY - this.stick.cy;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx *= radius / len;
        dy *= radius / len;
      }
      this.stick.x = dx / radius;
      this.stick.y = dy / radius;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const ours = (e: TouchEvent) => [...e.changedTouches].find((t) => t.identifier === this.stick.id);
    // touch events + preventDefault: iOS Safari cancels pointer drags as page gestures
    const opts = { passive: false };
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.stick.id !== null) return;
      const t = e.changedTouches[0], rect = stick.getBoundingClientRect();
      this.stick = { id: t.identifier, x: 0, y: 0, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
      move(t);
    }, opts);
    stick.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = ours(e);
      if (t) move(t);
    }, opts);
    const release = (e: TouchEvent) => {
      if (!ours(e)) return;
      this.stick = { ...this.stick, id: null, x: 0, y: 0 };
      knob.style.transform = '';
    };
    stick.addEventListener('touchend', release);
    stick.addEventListener('touchcancel', release);

    root.querySelector('.action')!.addEventListener('pointerdown', () => (this.actionQueued = true));
    this.sirenButton = root.querySelector<HTMLButtonElement>('.punch')!;
    this.sirenButton.addEventListener('pointerdown', () => {
      if (root.dataset.seat === 'emergency') this.sirenQueued = true;
      else this.punchQueued = true;
    });
    const handbrake = root.querySelector<HTMLButtonElement>('.handbrake')!;
    handbrake.addEventListener('pointerdown', () => (this.touchHandbrake = true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      handbrake.addEventListener(ev, () => (this.touchHandbrake = false));
    }
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
