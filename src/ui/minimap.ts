import type { CityData, LandmarkId } from '../world/cityData';
import { MINIMAP_SCALE as SCALE } from './minimapConfig';

const VIEW_RADIUS = 220;
const SIZE = 170;

const LABELS: Partial<Record<LandmarkId, string>> = {
  cathedral: 'Cathedral', centraal: 'Centraal', mas: 'MAS', steen: 'Het Steen', boerentoren: 'Boerentoren', stadhuis: 'Stadhuis',
};

export class Minimap {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private map = new Image();
  private minX: number;
  private minZ: number;
  private marks: { x: number; z: number; label: string }[];
  private frame = 0;

  constructor(city: CityData) {
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.id = 'minimap';
    this.canvas.width = this.canvas.height = SIZE * dpr;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    document.body.append(this.canvas);
    ({ minX: this.minX, minZ: this.minZ } = city.bounds);
    this.map.src = '/map/minimap.webp';
    this.marks = city.landmarks.filter((l) => LABELS[l.id]).map((l) => ({ x: l.x, z: l.z, label: LABELS[l.id]! }));
  }

  update(x: number, z: number, yaw: number, heading: number, others: { x: number; z: number; heading: number }[] = []) {
    if (this.frame++ % 2) return;
    const c = this.ctx, r = SIZE / 2, k = (r / VIEW_RADIUS) / SCALE;
    c.save();
    c.clearRect(0, 0, SIZE, SIZE);
    c.beginPath();
    c.arc(r, r, r - 2, 0, Math.PI * 2);
    c.clip();
    const turn = -Math.PI / 2 - yaw;
    c.translate(r, r);
    c.rotate(turn);
    c.scale(k, k);
    if (this.map.complete && this.map.naturalWidth) c.drawImage(this.map, -(x - this.minX) * SCALE, -(z - this.minZ) * SCALE);
    c.restore();

    const toMap = (px: number, pz: number): [number, number, boolean] => {
      const dx = px - x, dz = pz - z;
      const sx = (dx * Math.cos(turn) - dz * Math.sin(turn)) * (r / VIEW_RADIUS);
      const sy = (dx * Math.sin(turn) + dz * Math.cos(turn)) * (r / VIEW_RADIUS);
      const d = Math.hypot(sx, sy), edge = r - 9;
      return d > edge ? [r + (sx / d) * edge, r + (sy / d) * edge, true] : [r + sx, r + sy, false];
    };
    c.font = '600 10px system-ui, sans-serif';
    c.textAlign = 'center';
    for (const m of this.marks) {
      const [mx, my, off] = toMap(m.x, m.z);
      c.fillStyle = '#d2a640';
      c.beginPath();
      c.arc(mx, my, off ? 3 : 4, 0, Math.PI * 2);
      c.fill();
      if (!off) {
        c.fillStyle = '#1b1d22';
        c.fillText(m.label, mx, my - 7);
      }
    }
    for (const o of others) {
      const [ox, oy] = toMap(o.x, o.z);
      this.arrow(ox, oy, o.heading + turn, '#1e88e5', 0.75);
    }
    this.arrow(r, r, heading + turn, '#e53935');
  }

  private arrow(x: number, y: number, angle: number, colour: string, scale = 1) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.rotate(angle + Math.PI / 2);
    c.scale(scale, scale);
    c.fillStyle = colour;
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -8);
    c.lineTo(6, 6);
    c.lineTo(0, 3);
    c.lineTo(-6, 6);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }
}
