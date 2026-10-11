import type { Gps } from '../game/gps';
import type { CityData } from '../world/cityData';
import type { NavGraph } from '../world/navGraph';
import { drawArrow, drawPin, drawRoute, landmarkMarks } from './minimap';
import { MINIMAP_SCALE as SCALE } from './minimapConfig';

const CLICK_SLOP = 6; // px
const MAX_ZOOM = 3; // screen px per metre
const PIN_HIT = 18; // px

type Blip = { x: number; z: number; heading: number };

export class WorldMap {
  open = false;
  private root = document.createElement('div');
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private dest = document.createElement('div');
  private street = document.createElement('div');
  private image = new Image();
  private bounds: CityData['bounds'];
  private marks: { x: number; z: number; label: string }[];
  private view = { x: 0, z: 0, zoom: 1 };
  private pointers = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private message = '';
  private player: Blip = { x: 0, z: 0, heading: 0 };
  private others: Blip[] = [];

  constructor(city: CityData, private gps: Gps, private drive: NavGraph, touch: boolean) {
    this.root.id = 'worldmap';
    this.root.hidden = true;
    this.dest.className = 'dest';
    this.street.className = 'street';
    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = touch
      ? 'Tap to set a waypoint · tap it again to clear · drag and pinch to move'
      : 'Click: set waypoint · Right-click: clear · Drag: move · Scroll: zoom · P or Esc: close';
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close (P)';
    close.addEventListener('click', () => this.toggle(false));
    this.root.append(this.canvas, this.dest, this.street, help, close);
    document.body.append(this.root);
    this.ctx = this.canvas.getContext('2d')!;
    this.image.src = '/map/minimap.webp';
    this.bounds = city.bounds;
    this.marks = landmarkMarks(city);

    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'KeyP') this.toggle(!this.open);
      else if (this.open && e.code === 'Escape') this.toggle(false);
      else if (this.open && (e.code === 'Delete' || e.code === 'Backspace')) this.gps.clear();
    });

    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = this.pointers.size > 1 ? Infinity : 0;
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.hoverAt(e.clientX, e.clientY);
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const before = this.pinch();
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      const after = this.pinch();
      if (before && after) {
        this.zoomAt(before.x, before.y, after.d / before.d);
        this.pan(after.x - before.x, after.y - before.y);
      } else {
        this.pan(dx, dy);
        this.moved += Math.hypot(dx, dy);
      }
    });
    const end = (e: PointerEvent) => {
      if (e.type === 'pointerup' && e.button === 0 && this.pointers.size === 1 && this.moved < CLICK_SLOP) this.click(e.clientX, e.clientY);
      this.pointers.delete(e.pointerId);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)));
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.gps.clear();
    });
  }

  toggle(open: boolean) {
    if (open && document.body.classList.contains('on-title')) return;
    this.open = open;
    this.root.hidden = !open;
    this.pointers.clear();
    if (!open) return;
    this.message = '';
    this.street.textContent = '';
    Object.assign(this.view, { x: this.player.x, z: this.player.z, zoom: Math.max(1, this.minZoom) });
    this.draw();
  }

  update(x: number, z: number, heading: number, others: Blip[] = []) {
    this.player = { x, z, heading };
    this.others = others;
    if (this.open) this.draw();
  }

  private get minZoom() {
    const { minX, minZ, maxX, maxZ } = this.bounds;
    return Math.min(innerWidth / (maxX - minX), innerHeight / (maxZ - minZ)) * 0.9;
  }

  private toWorld(sx: number, sy: number): [number, number] {
    const v = this.view;
    return [v.x + (sx - innerWidth / 2) / v.zoom, v.z + (sy - innerHeight / 2) / v.zoom];
  }

  private toScreen(x: number, z: number): [number, number] {
    const v = this.view;
    return [(x - v.x) * v.zoom + innerWidth / 2, (z - v.z) * v.zoom + innerHeight / 2];
  }

  private pan(dx: number, dy: number) {
    const v = this.view, b = this.bounds;
    v.x = Math.max(b.minX, Math.min(b.maxX, v.x - dx / v.zoom));
    v.z = Math.max(b.minZ, Math.min(b.maxZ, v.z - dy / v.zoom));
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wz] = this.toWorld(sx, sy);
    this.view.zoom = Math.max(this.minZoom, Math.min(MAX_ZOOM, this.view.zoom * factor));
    const [nx, nz] = this.toWorld(sx, sy);
    this.view.x += wx - nx;
    this.view.z += wz - nz;
    this.pan(0, 0);
  }

  private pinch(): { x: number; y: number; d: number } | null {
    if (this.pointers.size < 2) return null;
    const [a, b] = this.pointers.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1) };
  }

  private click(sx: number, sy: number) {
    const w = this.gps.waypoint;
    if (w) {
      const [px, py] = this.toScreen(w.x, w.z);
      if (Math.hypot(px - sx, py - sy) < PIN_HIT) {
        this.gps.clear();
        return;
      }
    }
    const [x, z] = this.toWorld(sx, sy);
    this.message = this.gps.set(x, z) ? '' : 'No road near there';
  }

  private hoverAt(sx: number, sy: number) {
    const [x, z] = this.toWorld(sx, sy);
    const near = this.drive.nearest(x, z, Math.max(10, 14 / this.view.zoom));
    const name = near ? (this.drive.edges[near.edge].n ?? '') : '';
    if (this.street.textContent !== name) this.street.textContent = name;
  }

  private draw() {
    const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio, 2);
    const cv = this.canvas, c = this.ctx, v = this.view;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.save();
    c.translate(W / 2, H / 2);
    c.scale(v.zoom, v.zoom);
    c.translate(-v.x, -v.z);
    const { minX, minZ } = this.bounds;
    if (this.image.complete && this.image.naturalWidth) {
      c.imageSmoothingQuality = 'high';
      c.drawImage(this.image, minX, minZ, this.image.naturalWidth / SCALE, this.image.naturalHeight / SCALE);
    }
    if (this.gps.route) drawRoute(c, this.gps.route.points, 0, 0, 1, 6 / v.zoom);
    c.restore();

    c.font = '700 13px system-ui, sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 3;
    c.strokeStyle = 'rgb(255 255 255 / 0.85)';
    for (const m of this.marks) {
      const [x, y] = this.toScreen(m.x, m.z);
      c.fillStyle = '#d2a640';
      c.beginPath();
      c.arc(x, y, 5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#1b1d22';
      c.strokeText(m.label, x, y - 9);
      c.fillText(m.label, x, y - 9);
    }
    const w = this.gps.waypoint;
    if (w) drawPin(c, ...this.toScreen(w.x, w.z), 1.3);
    for (const o of this.others) drawArrow(c, ...this.toScreen(o.x, o.z), o.heading, '#1e88e5', 1);
    drawArrow(c, ...this.toScreen(this.player.x, this.player.z), this.player.heading, '#e53935', 1.4);

    const r = this.gps.route;
    const text = !w ? this.message
      : `${this.gps.destination || 'Waypoint'} · ${r ? (r.length < 1000 ? `${Math.round(r.length / 10) * 10} m` : `${(r.length / 1000).toFixed(1)} km`) : 'no route'}`;
    if (this.dest.textContent !== text) this.dest.textContent = text;
  }
}
