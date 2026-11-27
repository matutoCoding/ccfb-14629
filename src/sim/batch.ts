import type { Vec3 } from '../lib/math3d';
import { clamp } from '../lib/math3d';
import { projectCamera, type CameraModel } from '../lib/camera';
import type { SimFish, FishWorld, WaterState } from './world';

export type RGBA = [number, number, number, number?];

export class BatchBuilder {
  triangles: number[] = [];
  lines: number[] = [];

  private pushVertex(arr: number[], x: number, y: number, c: RGBA, alphaScale = 1) {
    arr.push(x, y, c[0], c[1], c[2], (c[3] ?? 1) * alphaScale);
  }

  tri(a: [number, number], b: [number, number], c: [number, number], color: RGBA) {
    this.pushVertex(this.triangles, a[0], a[1], color);
    this.pushVertex(this.triangles, b[0], b[1], color);
    this.pushVertex(this.triangles, c[0], c[1], color);
  }

  line(a: [number, number], b: [number, number], color: RGBA) {
    this.pushVertex(this.lines, a[0], a[1], color);
    this.pushVertex(this.lines, b[0], b[1], color);
  }

  polyline(points: ([number, number] | null)[], color: RGBA, close = false) {
    for (let i = 1; i < points.length; i++) {
      if (points[i - 1] && points[i]) this.line(points[i - 1]!, points[i]!, color);
    }
    if (close && points.length > 2 && points[0] && points[points.length - 1]) {
      this.line(points[points.length - 1]!, points[0]!, color);
    }
  }

  circle(cx: number, cy: number, r: number, color: RGBA, segments = 14, filled = true) {
    const pts: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    if (filled) {
      for (let i = 0; i < segments; i++) this.tri([cx, cy], pts[i], pts[(i + 1) % segments], color);
    } else {
      this.polyline(pts, color, true);
    }
  }
}

function fogColor(base: RGBA, depthZ: number, water: WaterState): RGBA {
  const fog = clamp((depthZ - 0.7) / Math.max(1, water.visibilityM), 0, 0.82);
  return [
    base[0] * (1 - fog) + water.color[0] * fog,
    base[1] * (1 - fog) + water.color[1] * fog,
    base[2] * (1 - fog) + water.color[2] * fog,
    base[3] ?? 1,
  ];
}

function projectOrNull(p: Vec3, cam: CameraModel): [number, number, number] | null {
  const q = projectCamera(p, cam);
  return q ? [q.u, q.v, q.z] : null;
}

function fishRadii(s: number, L: number): { h: number; w: number } {
  const envelope = Math.pow(Math.sin(Math.PI * clamp(s * 1.04, 0.02, 0.98)), 0.72);
  const h = L * (0.018 + 0.105 * envelope) * (s > 0.82 ? 1 - (s - 0.82) * 0.55 : 1);
  const w = h * 0.52;
  return { h: Math.max(L * 0.012, h), w: Math.max(L * 0.008, w) };
}

function fishColor(theta: number, z: number, water: WaterState): RGBA {
  const dorsal: RGBA = [0.16, 0.20, 0.10];
  const gold: RGBA = [0.70, 0.57, 0.22];
  const belly: RGBA = [0.86, 0.84, 0.68];
  const t = (Math.sin(theta) + 1) / 2;
  let c: RGBA;
  if (t < 0.55) {
    const k = t / 0.55;
    c = [belly[0] + (gold[0] - belly[0]) * k, belly[1] + (gold[1] - belly[1]) * k, belly[2] + (gold[2] - belly[2]) * k];
  } else {
    const k = (t - 0.55) / 0.45;
    c = [gold[0] + (dorsal[0] - gold[0]) * k, gold[1] + (dorsal[1] - gold[1]) * k, gold[2] + (dorsal[2] - gold[2]) * k];
  }
  return fogColor(c, z, water);
}

function addFish(batch: BatchBuilder, fish: SimFish, cam: CameraModel, water: WaterState) {
  const L = fish.trueLengthMm / 1000;
  const ringCount = fish.spine.length;
  const sides = 8;
  const rings: ([number, number, number] | null)[][] = [];
  for (let i = 0; i < ringCount; i++) {
    const s = i / (ringCount - 1);
    const { h, w } = fishRadii(s, L);
    const ring: ([number, number, number] | null)[] = [];
    for (let j = 0; j < sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const p: Vec3 = [
        fish.spine[i][0] + fish.side[0] * Math.cos(th) * w + fish.up[0] * Math.sin(th) * h,
        fish.spine[i][1] + fish.side[1] * Math.cos(th) * w + fish.up[1] * Math.sin(th) * h,
        fish.spine[i][2] + fish.side[2] * Math.cos(th) * w + fish.up[2] * Math.sin(th) * h,
      ];
      ring.push(projectOrNull(p, cam));
    }
    rings.push(ring);
  }
  for (let i = 0; i < ringCount - 1; i++) {
    const z = projectCamera(fish.spine[i], cam)?.z ?? 2;
    for (let j = 0; j < sides; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % sides];
      const c = rings[i + 1][(j + 1) % sides], d = rings[i + 1][j];
      if (!a || !b || !c || !d) continue;
      const col = fishColor((j / sides) * Math.PI * 2, z, water);
      batch.tri([a[0], a[1]], [b[0], b[1]], [c[0], c[1]], col);
      batch.tri([a[0], a[1]], [c[0], c[1]], [d[0], d[1]], col);
    }
  }

  // Forked caudal fin: the middle notch, not the lobe tip, is the fork-length endpoint.
  const at = (s: number): Vec3 => {
    const idx = clamp(Math.round(s * (ringCount - 1)), 0, ringCount - 1);
    return fish.spine[idx];
  };
  const tailBase = at(0.84);
  const fork = fish.spine[ringCount - 1];
  const { h } = fishRadii(0.86, L);
  const upperBase: Vec3 = [tailBase[0] + fish.up[0] * h * 0.8, tailBase[1] + fish.up[1] * h * 0.8, tailBase[2] + fish.up[2] * h * 0.8];
  const lowerBase: Vec3 = [tailBase[0] - fish.up[0] * h * 0.7, tailBase[1] - fish.up[1] * h * 0.7, tailBase[2] - fish.up[2] * h * 0.7];
  const upperLobe: Vec3 = [fork[0] - fish.forward[0] * L * 0.17 + fish.up[0] * L * 0.105, fork[1] - fish.forward[1] * L * 0.17 + fish.up[1] * L * 0.105, fork[2] - fish.forward[2] * L * 0.17 + fish.up[2] * L * 0.105];
  const lowerLobe: Vec3 = [fork[0] - fish.forward[0] * L * 0.15 - fish.up[0] * L * 0.09, fork[1] - fish.forward[1] * L * 0.15 - fish.up[1] * L * 0.09, fork[2] - fish.forward[2] * L * 0.15 - fish.up[2] * L * 0.09];
  const pts = [upperBase, upperLobe, fork, lowerLobe, lowerBase].map((p) => projectOrNull(p, cam));
  if (pts.every(Boolean)) {
    const z = pts[2]![2];
    const fin = fogColor([0.72, 0.55, 0.20, 0.48], z, water);
    for (let i = 1; i < pts.length - 1; i++) batch.tri([pts[0]![0], pts[0]![1]], [pts[i]![0], pts[i]![1]], [pts[i + 1]![0], pts[i + 1]![1]], fin);
  }

  // Eye.
  const head = projectOrNull(at(0.13), cam);
  if (head) {
    const eyePos: [number, number] = [head[0] + 2.2, head[1] - 2.0];
    batch.circle(eyePos[0], eyePos[1], clamp(3.2 - head[2] * 0.45, 1.4, 3.4), [0.02, 0.025, 0.018, 0.95], 12);
    batch.circle(eyePos[0] + 0.8, eyePos[1] - 0.7, 0.8, [0.9, 0.9, 0.75, 0.9], 8);
  }
}

function addNet(batch: BatchBuilder, world: FishWorld, cam: CameraModel, water: WaterState) {
  const R = world.radiusM;
  const netColor: RGBA = [0.10, 0.24, 0.22, 0.42];
  for (let y = 0; y >= -world.depthM; y -= 1.25) {
    const pts: ([number, number] | null)[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      pts.push(projectOrNull([R * Math.cos(a), y, R * Math.sin(a)], cam)?.slice(0, 2) as [number, number] | null);
    }
    batch.polyline(pts, y === 0 ? [0.35, 0.42, 0.34, 0.75] : netColor);
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const pts: ([number, number] | null)[] = [];
    for (let j = 0; j <= 10; j++) {
      const y = -(j / 10) * world.depthM;
      pts.push(projectOrNull([R * Math.cos(a), y, R * Math.sin(a)], cam)?.slice(0, 2) as [number, number] | null);
    }
    batch.polyline(pts, netColor);
  }
}

function addMarineSnow(batch: BatchBuilder, world: FishWorld, cam: CameraModel) {
  // Deterministic suspended particles; time drift is slow enough not to harm measurement overlays.
  for (let i = 0; i < 90; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const rr = world.radiusM * (0.15 + ((i * 37) % 80) / 100);
    const y = -(((i * 13) % 90) / 100) * world.depthM;
    const drift = Math.sin(world.timeSec * 0.22 + i) * 0.18;
    const p = projectOrNull([rr * Math.cos(a + drift * 0.05), y + drift, rr * Math.sin(a + drift * 0.05)], cam);
    if (p && p[0] > 0 && p[0] < cam.width && p[1] > 0 && p[1] < cam.height && p[2] < 4.5) {
      batch.circle(p[0], p[1], 0.7 + (i % 3) * 0.25, [0.72, 0.86, 0.82, 0.22], 6);
    }
  }
}

export function buildCameraBatch(world: FishWorld, cam: CameraModel): BatchBuilder {
  const batch = new BatchBuilder();
  const water = world.water(-cam.eye[1]);
  addNet(batch, world, cam, water);
  addMarineSnow(batch, world, cam);
  // Painter-ish ordering: farther fish first.
  const withDepth = world.fishes
    .map((fish) => ({ fish, z: projectCamera(fish.position, cam)?.z ?? 99 }))
    .filter((x) => x.z < 8)
    .sort((a, b) => b.z - a.z);
  for (const { fish } of withDepth) addFish(batch, fish, cam, water);
  // Vignette/turbidity border as geometry would be expensive; CSS overlay handles it.
  return batch;
}
