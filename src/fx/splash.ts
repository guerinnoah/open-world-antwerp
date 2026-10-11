import * as THREE from 'three';

export class Splash {
  readonly points: THREE.Points;
  private velocities: Float32Array;
  private life = 0;
  private readonly count = 80;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    this.velocities = new Float32Array(this.count * 3);
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  burst(x: number, z: number) {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
      pos.setXYZ(i, x + Math.cos(a) * r, 0.1, z + Math.sin(a) * r);
      this.velocities.set([Math.cos(a) * (1 + Math.random() * 3), 3 + Math.random() * 5, Math.sin(a) * (1 + Math.random() * 3)], i * 3);
    }
    this.life = 1.6;
  }

  update(dt: number) {
    if (this.life <= 0) return;
    this.life -= dt;
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      this.velocities[i * 3 + 1] -= 9.8 * dt;
      pos.setXYZ(i, pos.getX(i) + this.velocities[i * 3] * dt, Math.max(0, pos.getY(i) + this.velocities[i * 3 + 1] * dt), pos.getZ(i) + this.velocities[i * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = Math.max(0, Math.min(1, this.life));
  }
}
