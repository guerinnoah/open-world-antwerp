import { coarsePointer } from './quality';

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
}

const DEADZONE = 0.15;
const dead = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const CLICK_SLOP = 6; // px: a mouse press that moves less is a click (a punch), not a look-around drag

export class Input {
  readonly touch = coarsePointer();
  private keys = new Set<string>();
  private actionQueued = false;
  private punchQueued = false;
  private look = { x: 0, y: 0 };
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  private stick = { id: -1, x: 0, y: 0, cx: 0, cy: 0 };
  private touchHandbrake = false;
  private padActionHeld = false;
  private padPunchHeld = false;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'Enter') this.actionQueued = true;
      if (e.code === 'KeyR') this.punchQueued = true;
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
    const k = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    let steer = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    let throttle = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
    let handbrake = k('Space');
    let sprint = k('ShiftLeft', 'ShiftRight');
    let lookX = this.look.x;
    let lookY = this.look.y;
    let action = this.actionQueued;
    let horn = k('KeyH');
    let punch = this.punchQueued;

    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad || pad.mapping !== 'standard') continue;
      // Standard mapping: RT/LT gas/brake, A/RB handbrake (A sprints on foot), Y/B enter/exit, X punch, L3 horn.
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
    }

    if (this.stick.id >= 0) {
      steer += this.stick.x;
      throttle -= this.stick.y;
      sprint ||= Math.hypot(this.stick.x, this.stick.y) > 0.95;
    }
    handbrake ||= this.touchHandbrake;

    this.look.x = this.look.y = 0;
    this.actionQueued = this.punchQueued = false;
    return { steer: clamp1(steer), throttle: clamp1(throttle), handbrake, sprint, lookX, lookY, action, horn, punch };
  }

  private createTouchControls() {
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <button class="btn action" type="button">E</button>
      <button class="btn punch" type="button">Punch</button>
      <button class="btn handbrake" type="button">Handbrake</button>`;
    document.body.append(root);

    const stick = root.querySelector<HTMLDivElement>('.stick')!;
    const knob = root.querySelector<HTMLDivElement>('.knob')!;
    const radius = 50;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.cx, dy = e.clientY - this.stick.cy;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx *= radius / len;
        dy *= radius / len;
      }
      this.stick.x = dx / radius;
      this.stick.y = dy / radius;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      const rect = stick.getBoundingClientRect();
      this.stick = { id: e.pointerId, x: 0, y: 0, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    stick.addEventListener('pointermove', move);
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { ...this.stick, id: -1, x: 0, y: 0 };
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    root.querySelector('.action')!.addEventListener('pointerdown', () => (this.actionQueued = true));
    root.querySelector('.punch')!.addEventListener('pointerdown', () => (this.punchQueued = true));
    const handbrake = root.querySelector<HTMLButtonElement>('.handbrake')!;
    handbrake.addEventListener('pointerdown', () => (this.touchHandbrake = true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      handbrake.addEventListener(ev, () => (this.touchHandbrake = false));
    }
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
