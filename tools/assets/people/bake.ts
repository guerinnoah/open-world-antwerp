// Browser-side, driven by bake-people.ts: bakes one Rocketbox avatar's atlas, LODs and bone matrices for src/actors/crowd.ts.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { BIKE } from '../../../src/actors/bikeGeometry';
import { MOPED, MOTORBIKE, type RideGeometry } from '../../../src/actors/motorbikeGeometry';
import { SCOOTER } from '../../../src/actors/scooterGeometry';

const fbx = new FBXLoader();
const tga = new TGALoader();
const TARGET_TRIS = 3200;
const FAR_TRIS = 900;
const ATLAS = 1024;
const FRAMES = { walk: 20, run: 16, idle: 24 };
type Clip = keyof typeof FRAMES;
const RIDE_FRAMES = 24;
const SCOOT_FRAMES = 16;
const SEATED_FRAMES = 16;
const PUNCH_FRAMES = 12;
const PUNCH_SECONDS = 0.45; // keep in step with PUNCH_TIME in src/actors/player.ts

// Avatar space (Y-up, centimetres, facing +z) → game space (metres, facing +x).
const CORRECTION = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01));

/** Loads a clip and loops it in place; travel is the root's distance per cycle (m), the stride the game matches to speed. */
async function loadClip(path: string): Promise<{ clip: THREE.AnimationClip; travel: number }> {
  const group = await fbx.loadAsync(path);
  const clip = group.animations[0];
  // Rotations and the root's bob only: other position tracks would impose the clip's bone lengths on other avatars.
  clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || /^Bip01\.position$/.test(t.name));
  let travel = 0;
  const root = clip.tracks.find((t) => /^Bip01\.position$/.test(t.name));
  if (root) {
    const v = root.values, n = v.length / 3;
    travel = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]) / 100;
    for (let i = 0; i < n; i++) {
      v[i * 3] = v[0];
      v[i * 3 + 2] = v[2];
    }
  }
  return { clip, travel };
}

async function loadTexture(url: string | null): Promise<ImageData | null> {
  if (!url) return null;
  const tex = await tga.loadAsync(url);
  const { data, width, height } = tex.image as { data: Uint8Array; width: number; height: number };
  return new ImageData(new Uint8ClampedArray(data), width, height);
}

const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();

function turnBone(bone: THREE.Object3D, q: THREE.Quaternion) {
  const parent = bone.parent!.getWorldQuaternion(Q()).invert();
  bone.quaternion.copy(parent.multiply(q.clone().multiply(bone.getWorldQuaternion(Q()))));
  bone.updateMatrixWorld(true);
}

function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  turnBone(bone, Q().setFromUnitVectors(from.clone().normalize(), to.clone().normalize()));
}

/** Two-bone IK: bends a (hip/shoulder) and b (knee/elbow) so c (ankle/wrist) reaches target, bending towards pole. */
function twoBoneIK(a: THREE.Bone, b: THREE.Bone, c: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3) {
  const A = a.getWorldPosition(V()), B = b.getWorldPosition(V()), C = c.getWorldPosition(V());
  const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
  const toT = target.clone().sub(A);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const dir = toT.normalize();
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const knee = A.clone().addScaledVector(dir, l1 * cos).addScaledVector(perp, l1 * sin);
  aimBone(a, B.clone().sub(A), knee.clone().sub(A));
  const B2 = b.getWorldPosition(V()), C2 = c.getWorldPosition(V());
  aimBone(b, C2.clone().sub(B2), A.clone().addScaledVector(dir, d).sub(B2));
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

interface BakeInput {
  fbx: string;
  textures: { body: string; head: string; opacity: string | null };
  anims: Record<Clip, string>;
}

async function bake(input: BakeInput) {
  await MeshoptSimplifier.ready;
  const group = await fbx.loadAsync(input.fbx);
  let mesh: THREE.SkinnedMesh | null = null;
  group.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) throw new Error('no skinned mesh');
  const skinned = mesh as THREE.SkinnedMesh;
  group.updateMatrixWorld(true);

  const quadrant: Record<string, [number, number]> = { body: [0, 0], head: [0.5, 0], opacity: [0, 0.5] };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  for (const [key, url] of Object.entries(input.textures)) {
    const image = await loadTexture(url);
    if (!image) continue;
    const tmp = document.createElement('canvas');
    tmp.width = image.width;
    tmp.height = image.height;
    tmp.getContext('2d')!.putImageData(image, 0, 0);
    const [u, v] = quadrant[key];
    ctx.clearRect(u * ATLAS, v * ATLAS, ATLAS / 2, ATLAS / 2);
    ctx.drawImage(tmp, u * ATLAS, v * ATLAS, ATLAS / 2, ATLAS / 2);
  }

  const src = skinned.geometry;
  const materials = (Array.isArray(skinned.material) ? skinned.material : [skinned.material]).map((m) => m.name);
  const uv = src.getAttribute('uv').clone();
  const uvRange = [Infinity, -Infinity, Infinity, -Infinity];
  for (const g of src.groups) {
    const name = materials[g.materialIndex ?? 0] ?? '';
    const key = /opacity/.test(name) ? 'opacity' : /head/.test(name) ? 'head' : 'body';
    const [ou, ov] = quadrant[key];
    for (let i = g.start; i < g.start + g.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      uvRange[0] = Math.min(uvRange[0], u); uvRange[1] = Math.max(uvRange[1], u);
      uvRange[2] = Math.min(uvRange[2], v); uvRange[3] = Math.max(uvRange[3], v);
      const fu = u - Math.floor(u), fv = v - Math.floor(v);
      uv.setXY(i, ou + fu * 0.5, 1 - (ov + (1 - fv) * 0.5));
    }
  }
  const work = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) work.setAttribute(name, src.getAttribute(name));
  work.setAttribute('uv', uv);
  const welded = mergeVertices(work, 1e-3);
  const positions = welded.getAttribute('position').array as Float32Array;
  const indices = new Uint32Array(welded.index!.array);
  const [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, TARGET_TRIS * 3, 0.02, ['LockBorder']);
  const remap = new Map<number, number>();
  const order: number[] = [];
  const index = new Uint16Array(simplified.length);
  simplified.forEach((v, i) => {
    let n = remap.get(v);
    if (n === undefined) {
      n = order.length;
      remap.set(v, n);
      order.push(v);
    }
    index[i] = n;
  });
  const vc = order.length;
  const compactPos = new Float32Array(order.length * 3);
  order.forEach((v, i) => compactPos.set([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]], i * 3));
  const [farIndices] = MeshoptSimplifier.simplify(new Uint32Array(index), compactPos, 3, FAR_TRIS * 3, 0.05, ['LockBorder']);
  const indexFar = new Uint16Array(farIndices);
  const attr = (name: string) => welded.getAttribute(name);
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), tex = new Float32Array(vc * 2);
  const sIdx = new Uint8Array(vc * 4), sWgt = new Uint8Array(vc * 4);
  order.forEach((v, i) => {
    pos.set([attr('position').getX(v), attr('position').getY(v), attr('position').getZ(v)], i * 3);
    nor.set([attr('normal').getX(v), attr('normal').getY(v), attr('normal').getZ(v)], i * 3);
    tex.set([attr('uv').getX(v), attr('uv').getY(v)], i * 2);
    const w = [0, 1, 2, 3].map((k) => attr('skinWeight').getComponent(v, k));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    for (let k = 0; k < 4; k++) {
      sIdx[i * 4 + k] = attr('skinIndex').getComponent(v, k);
      sWgt[i * 4 + k] = Math.round((w[k] / sum) * 255);
    }
  });

  const bones = skinned.skeleton.bones;
  const boneInverses = skinned.skeleton.boneInverses;
  const mixer = new THREE.AnimationMixer(group);
  const clips: Record<string, { row: number; frames: number; stride: number; duration: number }> = {};
  const rows: Float32Array[] = [];
  const meshWorld = new THREE.Matrix4(), m = new THREE.Matrix4();
  const bakeRow = () => {
    group.updateMatrixWorld(true);
    meshWorld.copy(skinned.matrixWorld);
    const row = new Float32Array(bones.length * 12);
    bones.forEach((bone, i) => {
      m.copy(CORRECTION).multiply(meshWorld).multiply(skinned.bindMatrixInverse).multiply(bone.matrixWorld)
        .multiply(boneInverses[i]).multiply(skinned.bindMatrix);
      const e = m.elements;
      row.set([e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]], i * 12);
    });
    rows.push(row);
  };
  let idleClip: THREE.AnimationClip | null = null;
  for (const clipName of Object.keys(FRAMES) as Clip[]) {
    const { clip, travel } = await loadClip(input.anims[clipName]);
    if (clipName === 'idle') idleClip = clip;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    const frames = FRAMES[clipName];
    clips[clipName] = { row: rows.length, frames, stride: 0, duration: +clip.duration.toFixed(3) };
    for (let f = 0; f < frames; f++) {
      mixer.setTime((f / frames) * clip.duration);
      bakeRow();
    }
    clips[clipName].stride = clipName === 'idle' ? 0 : +travel.toFixed(3);
  }

  // IK works in the bones' world space. P, D: game-space point, direction (m; x forward, z right) into it; G: a bone out of it.
  const toGame = new THREE.Matrix4().copy(CORRECTION).multiply(skinned.matrixWorld).multiply(skinned.bindMatrixInverse);
  const toBones = toGame.clone().invert();
  const P = (p: THREE.Vector3) => p.clone().applyMatrix4(toBones);
  const D = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).transformDirection(toBones);
  const G = (bone: THREE.Bone) => bone.getWorldPosition(V()).applyMatrix4(toGame);
  const find = (re: RegExp) => {
    const b = bones.find((b) => re.test(b.name));
    if (!b) throw new Error(`no bone ${re}`);
    return b;
  };
  const root = group.getObjectByName('Bip01') ?? find(/Pelvis$/);
  const spine = find(/Spine$/), head = find(/Head$/);
  const leg = (s: string) => ['Thigh', 'Calf', 'Foot', 'Toe0'].map((n) => find(new RegExp(`${s}[ _]${n}$`)));
  const arm = (s: string) => ['UpperArm', 'Forearm', 'Hand'].map((n) => find(new RegExp(`${s}[ _]${n}$`)));
  const legs = { L: leg('L'), R: leg('R') }, arms = { L: arm('L'), R: arm('R') };
  mixer.stopAllAction();
  mixer.clipAction(idleClip!).reset().play();
  mixer.setTime(0);
  group.updateMatrixWorld(true);
  const [thigh, calf, foot, toe] = legs.R;
  const legLength = G(thigh).distanceTo(G(calf)) + G(calf).distanceTo(G(foot));
  const ball = G(toe).sub(G(foot));
  ball.z = 0;
  const leanAxis = D(0, 0, -1); // turning about -z tips the top (or the toes) forward and down
  const [bbx, bby] = BIKE.bb;
  const pedal = (a: number, side: number) => new THREE.Vector3(bbx + BIKE.crank * Math.sin(a), bby + BIKE.crank * Math.cos(a), side * BIKE.pedalZ);
  const ankling = (a: number) => 0.2 + 0.18 * Math.sin(a + 0.6);
  const ankleFor = (a: number, side: number) =>
    pedal(a, side).sub(ball.clone().applyAxisAngle(new THREE.Vector3(0, 0, -1), ankling(a))).add(new THREE.Vector3(0, 0.035, 0));
  const bottom = ankleFor(Math.PI, 1);
  const hipY = bottom.y + Math.sqrt((0.94 * legLength) ** 2 - (BIKE.seatX - bottom.x) ** 2);
  const seat = (f: number, frames: number, x: number, y: number, lean: number, headUp: number) => {
    mixer.setTime((f / frames) * idleClip!.duration);
    group.updateMatrixWorld(true);
    const hips = G(legs.L[0]).add(G(legs.R[0])).multiplyScalar(0.5);
    const shift = P(new THREE.Vector3(x, y, 0)).sub(P(hips));
    root.position.copy(root.parent!.worldToLocal(root.getWorldPosition(V()).add(shift)));
    root.updateMatrixWorld(true);
    turnBone(spine, Q().setFromAxisAngle(leanAxis, lean));
    turnBone(head, Q().setFromAxisAngle(leanAxis, -lean * headUp));
  };
  const pose = (f: number, lean: number) => seat(f, RIDE_FRAMES, BIKE.seatX, hipY, lean, 0.75);
  const [upper, fore, hand] = arms.R;
  const armLength = G(upper).distanceTo(G(fore)) + G(fore).distanceTo(G(hand));
  const leanToReach = (grip: THREE.Vector3, from: number, max: number, stretch: number, posed: (lean: number) => void) => {
    let lean = from;
    for (; lean < max; lean += 0.03) {
      posed(lean);
      if (G(upper).distanceTo(grip) < armLength * stretch) break;
    }
    return lean;
  };
  const holding = (grip: readonly number[], back: number) => (side: number) => new THREE.Vector3(grip[0] - back, grip[1] + 0.03, side * grip[2]);
  const plant = (side: 'L' | 'R', ankle: THREE.Vector3, knee: THREE.Vector3, turn?: THREE.Quaternion) => {
    const [t, c, ft] = legs[side];
    const flat = ft.getWorldQuaternion(Q());
    twoBoneIK(t, c, ft, P(ankle), knee);
    ft.quaternion.copy(c.getWorldQuaternion(Q()).invert().multiply(turn ? turn.multiply(flat) : flat));
    ft.updateMatrixWorld(true);
  };
  const grasp = (side: 'L' | 'R', wrist: THREE.Vector3, elbow: THREE.Vector3) => {
    const [u, fa, h] = arms[side];
    twoBoneIK(u, fa, h, P(wrist), elbow);
  };
  const wrist = holding(BIKE.grip, 0.05);
  const lean = leanToReach(wrist(1), 0.1, 0.6, 0.93, (l) => pose(0, l));
  clips.ride = { row: rows.length, frames: RIDE_FRAMES, stride: BIKE.development, duration: 1 };
  for (let f = 0; f < RIDE_FRAMES; f++) {
    pose(f, lean);
    const crank = (f / RIDE_FRAMES) * Math.PI * 2;
    for (const [side, s] of [['R', 1], ['L', -1]] as const) {
      const a = crank + (side === 'L' ? Math.PI : 0);
      plant(side, ankleFor(a, s), D(1, 0, s * 0.12), Q().setFromAxisAngle(leanAxis, ankling(a)));
      grasp(side, wrist(s), D(-0.35, -0.6, s * 0.7));
    }
    bakeRow();
  }
  const saddle = +(hipY - 0.09).toFixed(3);

  mixer.setTime(0);
  group.updateMatrixWorld(true);
  const ankleHeight = G(foot).y;
  const up = D(0, 1, 0);
  const feet = {
    L: { at: new THREE.Vector3(SCOOTER.frontFoot[0], SCOOTER.deck + ankleHeight, SCOOTER.frontFoot[1]), turn: 0, knee: D(1, 0, -0.1) },
    R: { at: new THREE.Vector3(SCOOTER.backFoot[0], SCOOTER.deck + ankleHeight, SCOOTER.backFoot[1]), turn: -SCOOTER.backFootTurn, knee: D(0.8, 0, 0.6) },
  };
  const reach = Math.max(...Object.values(feet).map((f) => Math.abs(SCOOTER.hipX - f.at.x)));
  const standY = SCOOTER.deck + ankleHeight + Math.sqrt((0.96 * legLength) ** 2 - reach ** 2);
  const stand = (f: number, lean: number) => seat(f, SCOOT_FRAMES, SCOOTER.hipX, standY, lean, 0.8);
  const bar = holding(SCOOTER.grip, 0.02);
  const scootLean = leanToReach(bar(1), 0, 0.5, 0.95, (l) => stand(0, l));
  clips.scoot = { row: rows.length, frames: SCOOT_FRAMES, stride: 0, duration: +idleClip!.duration.toFixed(3) };
  for (let f = 0; f < SCOOT_FRAMES; f++) {
    stand(f, scootLean);
    for (const [side, s] of [['L', -1], ['R', 1]] as const) {
      plant(side, feet[side].at, feet[side].knee, Q().setFromAxisAngle(up, feet[side].turn));
      grasp(side, bar(s), D(-0.3, -0.7, s * 0.6));
    }
    bakeRow();
  }

  mixer.setTime(0);
  group.updateMatrixWorld(true);
  const rest = bones.map((b) => b.quaternion.clone());
  const fingers = (s: string) => [0, 1, 2, 3, 4].map((n) => ['', '1', '2'].map((j) => find(new RegExp(`${s}[ _]Finger${n}${j}$`))));
  const hands = { L: fingers('L'), R: fingers('R') };
  const idle = Object.fromEntries((['L', 'R'] as const).map((s) => {
    const [u, fa, h] = arms[s];
    return [s, { wrist: G(h), elbow: G(fa).sub(G(u).add(G(h)).multiplyScalar(0.5)).normalize() }];
  })) as Record<'L' | 'R', { wrist: THREE.Vector3; elbow: THREE.Vector3 }>;
  const handAxes = (s: 'L' | 'R') => {
    const h = arms[s][2].getWorldPosition(V()), f = hands[s];
    const along = f[2][0].getWorldPosition(V()).sub(h).normalize();
    const across = f[1][0].getWorldPosition(V()).sub(f[4][0].getWorldPosition(V()));
    const palm = along.clone().cross(across).multiplyScalar(s === 'R' ? -1 : 1).normalize();
    return { along, palm };
  };
  const curl = (s: 'L' | 'R', thumb: number[], bend: number[]) => {
    const axes = handAxes(s);
    hands[s].forEach((finger, n) => {
      const dir = n === 0 ? finger[1].getWorldPosition(V()).sub(finger[0].getWorldPosition(V())).normalize() : axes.along.clone();
      const axis = dir.cross(axes.palm).normalize();
      finger.forEach((joint, j) => turnBone(joint, Q().setFromAxisAngle(axis, (n === 0 ? thumb : bend)[j])));
    });
  };
  const smooth = THREE.MathUtils.smoothstep;
  const jab = (f: number) => {
    const t = f / PUNCH_FRAMES;
    const guard = smooth(t, 0, 0.2) * (1 - smooth(t, 0.75, 1));
    const out = smooth(t, 0.12, 0.32) * (1 - smooth(t, 0.45, 0.8));
    mixer.setTime(0);
    bones.forEach((b, i) => b.quaternion.copy(rest[i]));
    group.updateMatrixWorld(true);
    turnBone(spine, Q().setFromAxisAngle(up, 0.4 * out).multiply(Q().setFromAxisAngle(leanAxis, 0.08 * out)));
    turnBone(head, Q().setFromAxisAngle(up, -0.32 * out));
    for (const [side, s] of [['L', -1], ['R', 1]] as const) {
      const [u, fa, h] = arms[side];
      const shoulder = G(u);
      const wrist = idle[side].wrist.clone().lerp(new THREE.Vector3(shoulder.x + 0.22, shoulder.y + 0.04, s * 0.12), guard);
      if (side === 'R') wrist.lerp(new THREE.Vector3(shoulder.x + armLength * 0.93, shoulder.y + 0.04, 0.03), out);
      const elbow = idle[side].elbow.clone().lerp(new THREE.Vector3(-0.2, -1, s * 0.5).normalize(), guard);
      grasp(side, wrist, D(elbow.x, elbow.y, elbow.z));
      const forearm = h.getWorldPosition(V()).sub(fa.getWorldPosition(V())).normalize();
      const { along, palm } = handAxes(side);
      const point = Q().setFromUnitVectors(along, forearm);
      const want = D(0, 0, -s).lerp(D(0, -1, 0), side === 'R' ? out : 0);
      want.addScaledVector(forearm, -want.dot(forearm)).normalize();
      const turned = palm.clone().applyQuaternion(point);
      const roll = Q().setFromUnitVectors(turned, want);
      turnBone(h, Q().slerp(roll.multiply(point), guard));
      curl(side, [0, 0.5 * guard, 0.6 * guard], [1.3 * guard, 1.5 * guard, 1.0 * guard]);
    }
  };
  clips.punch = { row: rows.length, frames: PUNCH_FRAMES, stride: 0, duration: PUNCH_SECONDS };
  for (let f = 0; f < PUNCH_FRAMES; f++) {
    jab(f);
    bakeRow();
  }

  const seated = (ride: RideGeometry) => {
    const sit = (f: number, lean: number) => {
      bones.forEach((b, i) => b.quaternion.copy(rest[i]));
      seat(f, SEATED_FRAMES, ride.hips[0], ride.hips[1], lean, 0.8);
    };
    const bar = holding(ride.grip, 0.02);
    const lean = leanToReach(bar(1), ride.lean, 0.7, 0.95, (l) => sit(0, l));
    const clip = { row: rows.length, frames: SEATED_FRAMES, stride: 0, duration: +idleClip!.duration.toFixed(3) };
    for (let f = 0; f < SEATED_FRAMES; f++) {
      sit(f, lean);
      for (const [side, s] of [['L', -1], ['R', 1]] as const) {
        plant(side, new THREE.Vector3(ride.feet[0], ride.feet[1] + ankleHeight, s * ride.feet[2]), D(1, 0.4, s * 0.25));
        grasp(side, bar(s), D(-0.3, -0.7, s * 0.6));
        curl(side, [0, 0.4, 0.4], [0.9, 1.0, 0.7]);
      }
      bakeRow();
    }
    return clip;
  };
  clips.moto = seated(MOTORBIKE);
  clips.moped = seated(MOPED);
  const boneData = new Uint16Array(rows.length * bones.length * 12);
  rows.forEach((row, r) => row.forEach((v, i) => (boneData[r * bones.length * 12 + i] = THREE.DataUtils.toHalfFloat(v))));

  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(pos, 3)).applyMatrix4(
    new THREE.Matrix4().copy(CORRECTION).multiply(skinned.matrixWorld),
  );

  const parts = { position: pos, normal: nor, uv: tex, skinIndex: sIdx, skinWeight: sWgt, index, indexFar, bones: boneData };
  const total = Object.values(parts).reduce((n, p) => n + p.byteLength + 4, 0);
  const bin = new Uint8Array(total);
  let offset = 0;
  const layout: Record<string, [number, number]> = {};
  for (const [name, p] of Object.entries(parts)) {
    offset = Math.ceil(offset / 4) * 4;
    bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offset);
    layout[name] = [offset, p.byteLength];
    offset += p.byteLength;
  }
  return {
    bin: toBase64(bin.subarray(0, offset)),
    atlas: canvas.toDataURL('image/webp', 0.85),
    meta: {
      vertices: vc, triangles: index.length / 3, farTriangles: indexFar.length / 3, sourceTriangles: src.getAttribute('position').count / 3, bones: bones.length,
      clips, layout, height: +box.max.y.toFixed(2), uvRange: uvRange.map((v) => +v.toFixed(2)), materials, saddle,
    },
  };
}

Object.assign(window, { bake });
(window as unknown as { ready: boolean }).ready = true;
