import * as THREE from 'three';

// Rain as slanted line streaks in a box that follows the camera. Drops fall and wrap; intensity scales how many show
// and how opaque they are. Cheap: one LineSegments, ~2k drops updated on the CPU each frame.
const DROPS = 2200;
const AREA = 60; // width/depth of the box around the camera, metres
const TOP = 40; // height of the box
const FALL = 34; // fall speed, m/s
const DRIFT = 5; // horizontal wind, m/s
const LEN = 0.9; // streak length, metres

export class Weather {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private material: THREE.LineBasicMaterial;
  private pos: Float32Array;
  private drops = new Float32Array(DROPS * 3); // local x, y, z per drop (box-relative)
  private intensity = 0;

  constructor() {
    this.group.name = 'weather';
    for (let i = 0; i < DROPS; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * AREA;
      this.drops[i * 3 + 1] = Math.random() * TOP;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * AREA;
    }
    this.pos = new Float32Array(DROPS * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.material = new THREE.LineBasicMaterial({ color: 0xaab6c4, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.group.visible = false;
  }

  setIntensity(rain: number) {
    this.intensity = Math.min(1, Math.max(0, rain));
    this.material.opacity = 0.4 * this.intensity;
    this.group.visible = this.intensity > 0.01;
  }

  update(camera: THREE.Vector3, dt: number) {
    if (!this.group.visible) return;
    const shown = Math.floor(DROPS * (0.3 + 0.7 * this.intensity));
    const fall = FALL * dt, drift = DRIFT * dt;
    for (let i = 0; i < DROPS; i++) {
      let x = this.drops[i * 3] + drift;
      let y = this.drops[i * 3 + 1] - fall;
      if (y < 0) y += TOP;
      if (x > AREA / 2) x -= AREA;
      this.drops[i * 3] = x;
      this.drops[i * 3 + 1] = y;
      // World position: box centred on the camera, raised so drops span from below to above the view.
      const wx = camera.x + x, wy = camera.y + y - TOP * 0.35, wz = camera.z + this.drops[i * 3 + 2];
      const o = i * 6;
      if (i < shown) {
        this.pos[o] = wx; this.pos[o + 1] = wy + LEN; this.pos[o + 2] = wz;
        this.pos[o + 3] = wx + 0.14; this.pos[o + 4] = wy; this.pos[o + 5] = wz; // slight wind slant
      } else {
        this.pos[o] = this.pos[o + 3] = wx; this.pos[o + 1] = this.pos[o + 4] = wy; this.pos[o + 2] = this.pos[o + 5] = wz; // degenerate = hidden
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
