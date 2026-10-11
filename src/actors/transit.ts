import * as THREE from 'three';
import { uploadFirst } from '../core/instancing';
import { pick, type Pose } from '../core/util';
import { GROUP, RAPIER, WHEELS, groups, type Owner, type Physics } from '../physics/physics';
import type { TramRun } from '../world/cityData';
import { pointAt } from '../world/polyline';
import { probeRoute } from './trackProbe';
import { displayAtlas, displayMaterial, type SectionModel } from './tramModel';

// What trams and buses share: kinematic sections riding a fixed route, serving its stops, drawn instanced.
export type Run<R extends TramRun = TramRun> = R & { cum: number[] };

export interface Sectioned {
  run: Run;
  s: number; // distance of the nose along the run (m)
  speed: number;
  nextStop: number;
  dwell: number;
  offsets: number[];
  length: number;
  row: number;
  sections: RAPIER.RigidBody[];
  prev: Pose[];
}

export interface Obstacle {
  gap: number; // m along the route to its near side; Infinity when clear
  solid: boolean; // kinematic (tram, bus, another player's car): nothing shoves it, so wait behind it
  owner?: Owner;
  touching: { body: RAPIER.RigidBody; dx: number; dz: number; side: number }[];
}

export const COLLIDES = groups(GROUP.VEHICLE, WHEELS | GROUP.PED); // cars, bikes, people, buses, trams; not walls: the routes keep clear of them

export function spawnPoint<R extends Run>(runs: R[], x: number, z: number, min: number, max: number, start: number, end: number): [R, number] | null {
  const candidates: [R, number][] = [];
  for (const run of runs) {
    for (let s = start; s < run.len - end; s += 40) {
      const p = pointAt(run.p, run.cum, s);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > min && d < max) candidates.push([run, s]);
    }
  }
  return candidates.length ? pick(candidates) : null;
}

export function stack<K extends string>(layout: K[], lengths: Record<K, number>) {
  const offsets: number[] = [];
  let length = 0;
  for (const kind of layout) {
    offsets.push(length + lengths[kind] / 2);
    length += lengths[kind];
  }
  return { offsets, length };
}

export function stopAfter(run: Run, s: number): number {
  const i = run.stops.findIndex((x) => x > s);
  return i < 0 ? run.stops.length : i;
}

export const occupied = (physics: Physics, pose: Pose, halfLength: number, halfWidth: number, filter?: number) =>
  physics.boxOverlaps(pose.x, pose.z, pose.angle, halfLength, halfWidth, RAPIER.QueryFilterFlags.EXCLUDE_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filter);

export function addSections(physics: Physics, v: Sectioned, kind: Owner['kind'], poses: Pose[], halfLengths: number[], halfWidth: number, events = false) {
  poses.forEach((pose, i) => {
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pose.x, pose.z).setRotation(pose.angle),
    );
    const desc = RAPIER.ColliderDesc.cuboid(halfLengths[i], halfWidth).setCollisionGroups(COLLIDES);
    if (events) desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    physics.owners.set(physics.world.createCollider(desc, body).handle, { kind, entity: v });
    v.sections.push(body);
    v.prev.push({ ...pose });
  });
}

export function removeSectioned<T extends Sectioned>(physics: Physics, all: T[], v: T) {
  const i = all.indexOf(v);
  if (i < 0) return; // already gone (splice(-1) would drop the last one and leave its bodies behind)
  for (const body of v.sections) physics.remove(body);
  all.splice(i, 1);
}

export function savePrev(all: Sectioned[]) {
  for (const v of all) {
    v.sections.forEach((body, i) => {
      const p = body.translation();
      v.prev[i] = { x: p.x, z: p.y, angle: body.rotation() };
    });
  }
}

export function moveSections(v: Sectioned, poses: Pose[]) {
  poses.forEach((pose, i) => {
    v.sections[i].setNextKinematicTranslation({ x: pose.x, y: pose.z });
    v.sections[i].setNextKinematicRotation(pose.angle);
  });
}

export function noseDistance(v: Sectioned, x: number, z: number): number {
  const nose = pointAt(v.run.p, v.run.cum, v.s);
  return Math.hypot(nose.x - x, nose.z - z);
}

export function outlineDistance(body: RAPIER.RigidBody, halfLength: number, halfWidth: number, x: number, z: number): number {
  const p = body.translation(), a = body.rotation();
  const dx = x - p.x, dz = z - p.y, c = Math.cos(a), s = Math.sin(a);
  return Math.hypot(Math.max(Math.abs(dx * c + dz * s) - halfLength, 0), Math.max(Math.abs(-dx * s + dz * c) - halfWidth, 0));
}

export function serveStops(v: Sectioned, target: number, brake: number, dt: number, dwell: () => number): number {
  if (v.dwell > 0) {
    v.dwell -= dt;
    if (v.dwell <= 0) v.nextStop++;
    return 0;
  }
  if (v.nextStop >= v.run.stops.length) return target;
  const ahead = v.run.stops[v.nextStop] - v.s;
  if (ahead >= 0.5) return Math.min(target, Math.sqrt(2 * brake * Math.max(ahead - 0.5, 0)));
  if (v.speed < 0.5) v.dwell = dwell();
  else v.nextStop++; // overshot it (pushed through traffic): skip this one
  return 0;
}

export function obstacleAhead(physics: Physics, v: Sectioned, from: number, dir: 1 | -1, look: number, halfWidth: number, inset: number): Obstacle {
  const own = new Set(v.sections.map((b) => b.handle));
  const hit: Obstacle = { gap: Infinity, solid: false, touching: [] };
  probeRoute(physics, v.run, from, dir, look, halfWidth + 0.1, COLLIDES, (c) => own.has(c.parent()!.handle), (o) => {
    const solid = o.collider.parent()!.isKinematic();
    if (o.across > (solid ? halfWidth + 0.1 : halfWidth - inset)) return false;
    const owner = physics.owners.get(o.collider.handle);
    if (o.gap < 0.3 && !solid && owner?.kind === 'vehicle') hit.touching.push({ body: o.collider.parent()!, dx: o.dx, dz: o.dz, side: o.side });
    if (o.gap < hit.gap) {
      hit.gap = o.gap;
      hit.solid = solid;
      hit.owner = owner;
    }
    return true;
  });
  return hit;
}

interface KindMeshes {
  body: THREE.InstancedMesh;
  display: { mesh: THREE.InstancedMesh; rows: THREE.InstancedBufferAttribute } | null;
  count: number;
}

export class SectionMeshes<K extends string> {
  private meshes = new Map<K, KindMeshes>();
  private rows: Map<string, number>;
  private rowCount: number;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(group: THREE.Group, runs: TramRun[], kinds: K[], build: (kind: K) => SectionModel, capacity: (kind: K) => number) {
    const atlas = displayAtlas(runs);
    this.rows = atlas.rows;
    this.rowCount = atlas.count;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.1 });
    const screen = displayMaterial(atlas.texture, atlas.count);
    const add = (mesh: THREE.InstancedMesh) => {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      group.add(mesh);
      return mesh;
    };
    for (const kind of kinds) {
      const model = build(kind), n = capacity(kind);
      const body = add(new THREE.InstancedMesh(model.body, material, n));
      let display: KindMeshes['display'] = null;
      if (model.display) {
        const rows = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        model.display.setAttribute('iRow', rows);
        display = { mesh: add(new THREE.InstancedMesh(model.display, screen, n)), rows };
      }
      this.meshes.set(kind, { body, display, count: 0 });
    }
  }

  row(run: TramRun): number {
    return this.rows.get(`${run.line}|${run.to}|${run.colour}`) ?? 0;
  }

  add(kind: K, pose: Pose, y: number, row: number) {
    const m = this.meshes.get(kind)!;
    if (m.count >= m.body.instanceMatrix.count) return;
    this.quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -pose.angle);
    this.matrix.compose(this.pos.set(pose.x, y, pose.z), this.quat, this.one);
    m.body.setMatrixAt(m.count, this.matrix);
    if (m.display) {
      m.display.mesh.setMatrixAt(m.count, this.matrix);
      m.display.rows.setX(m.count, Math.min(row, this.rowCount - 1));
    }
    m.count++;
  }

  finish() {
    for (const m of this.meshes.values()) {
      m.body.count = m.count;
      uploadFirst(m.body.instanceMatrix, m.count);
      if (m.display) {
        m.display.mesh.count = m.count;
        uploadFirst(m.display.mesh.instanceMatrix, m.count);
        uploadFirst(m.display.rows, m.count);
      }
      m.count = 0;
    }
  }
}
