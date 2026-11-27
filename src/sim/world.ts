import type { CameraRig } from '../types';
import { deterministicRandom, gaussian, normalize, type Vec3 } from '../lib/math3d';
import type { StereoRigModel } from '../lib/camera';

export interface SimFish {
  id: string;
  seed: number;
  targetLengthMm: number;
  trueLengthMm: number;
  ageClass: number;
  angle: number;
  orbitRadius: number;
  depth: number;
  angularSpeed: number;
  direction: 1 | -1;
  phase: number;
  tailFrequency: number;
  position: Vec3;
  forward: Vec3;
  side: Vec3;
  up: Vec3;
  spine: Vec3[];
  velocities?: number;
}

export interface WaterState {
  turbidity: number;
  light: number;
  color: [number, number, number];
  visibilityM: number;
  hour: number;
  tempC: number;
}

const UP: Vec3 = [0, 1, 0];

export function waterState(hour: number, depthM: number, tempC: number): WaterState {
  const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const depthLight = Math.exp(-depthM * 0.28);
  const light = Math.min(1, (0.18 + sun * 0.95) * depthLight);
  const turbidity = 0.42 + 0.18 * Math.sin(hour * 0.7) + depthM * 0.012;
  const visibilityM = 3.4 / Math.max(0.25, turbidity);
  // Coastal yellow croaker water: grey-green, darker with turbidity/depth.
  const r = 0.035 + light * 0.10 - turbidity * 0.025;
  const g = 0.16 + light * 0.20 - turbidity * 0.035;
  const b = 0.17 + light * 0.18 - turbidity * 0.02;
  return {
    turbidity,
    light,
    color: [Math.max(0.01, r), Math.max(0.05, g), Math.max(0.06, b)],
    visibilityM,
    hour,
    tempC,
  };
}

export class FishWorld {
  fishes: SimFish[] = [];
  radiusM: number;
  depthM: number;
  timeSec = 0;
  hour = 10.4;
  tempC = 22.6;
  private rand: () => number;

  constructor(cageId: string, perimeterM: number, depthM: number, count = 48, meanLengthMm = 372) {
    this.radiusM = perimeterM / (2 * Math.PI);
    this.depthM = depthM;
    const seed = [...cageId].reduce((a, c) => a + c.charCodeAt(0) * 17, 1337);
    this.rand = deterministicRandom(seed);
    for (let i = 0; i < count; i++) {
      const target = meanLengthMm + gaussian(this.rand) * 31;
      const angle = this.rand() * Math.PI * 2;
      const orbitRadius = this.radiusM * (0.34 + this.rand() * 0.48);
      const depth = 1.4 + this.rand() * Math.max(2, depthM - 2.2);
      const direction: 1 | -1 = this.rand() > 0.12 ? 1 : -1;
      const fish: SimFish = {
        id: `fish-${i + 1}`,
        seed: Math.floor(this.rand() * 1e9),
        targetLengthMm: target,
        trueLengthMm: target,
        ageClass: this.rand(),
        angle,
        orbitRadius,
        depth,
        angularSpeed: 0.055 + this.rand() * 0.075,
        direction,
        phase: this.rand() * Math.PI * 2,
        tailFrequency: 5.2 + this.rand() * 2.4,
        position: [0, -depth, 0],
        forward: [0, 0, 1],
        side: [1, 0, 0],
        up: [0, 1, 0],
        spine: [],
      };
      this.fishes.push(fish);
      this.updateFish(fish, 0, []);
    }
  }

  spineArcLengthMm(fish: SimFish): number {
    let m = 0;
    for (let i = 1; i < fish.spine.length; i++) {
      const a = fish.spine[i - 1], b = fish.spine[i];
      m += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    return m * 1000;
  }

  update(dt: number, rigs: StereoRigModel[] = []) {
    this.timeSec += dt;
    this.hour = (this.hour + dt * 0.018) % 24; // full day in ~22 simulation minutes
    const eyes = rigs.flatMap((r) => [r.left.eye, r.right.eye]);
    for (const f of this.fishes) this.updateFish(f, dt, eyes);
  }

  private updateFish(f: SimFish, dt: number, eyes: Vec3[]) {
    // Camera avoidance: move orbit inward and briefly accelerate when a lens is close.
    let avoid = 0;
    let burst = 1;
    const candidate: Vec3 = [
      f.orbitRadius * Math.cos(f.angle),
      -f.depth + Math.sin(this.timeSec * 0.35 + f.phase) * 0.22,
      f.orbitRadius * Math.sin(f.angle),
    ];
    for (const eye of eyes) {
      const d = Math.hypot(candidate[0] - eye[0], candidate[1] - eye[1], candidate[2] - eye[2]);
      if (d < 1.35) {
        avoid = Math.max(avoid, (1.35 - d) / 1.35);
        burst = 1 + avoid * 1.8;
      }
    }
    if (dt > 0) f.angle += f.direction * f.angularSpeed * burst * dt;
    const rTarget = f.orbitRadius * (1 - avoid * 0.34);
    const r = dt > 0 ? f.orbitRadius + (rTarget - f.orbitRadius) * Math.min(1, dt * 2.2) : rTarget;
    if (dt > 0) f.orbitRadius = r;
    const y = -f.depth + Math.sin(this.timeSec * 0.35 + f.phase) * 0.22;
    f.position = [r * Math.cos(f.angle), y, r * Math.sin(f.angle)];
    const tangent: Vec3 = normalize([-Math.sin(f.angle) * f.direction, 0, Math.cos(f.angle) * f.direction]);
    // Add a small radial avoidance component to heading.
    const radial: Vec3 = [Math.cos(f.angle), 0, Math.sin(f.angle)];
    f.forward = normalize([
      tangent[0] - radial[0] * avoid * 0.55,
      Math.sin(this.timeSec * 0.7 + f.phase) * 0.025,
      tangent[2] - radial[2] * avoid * 0.55,
    ]);
    f.side = normalize(crossUp(this.forwardSafe(f.forward)));
    f.up = normalize(crossSafe(f.forward, f.side));

    const L = f.trueLengthMm / 1000 || f.targetLengthMm / 1000;
    const segments = 10;
    f.spine = [];
    const wavePhase = this.timeSec * f.tailFrequency + f.phase;
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const longitudinal = (0.5 - s) * L;
      const amp = L * (0.012 + 0.082 * Math.pow(s, 1.75));
      const wave = Math.sin(s * Math.PI * 1.35 - wavePhase) * amp;
      // A slow body curvature means segmented measurement remains necessary.
      const curve = Math.sin(this.timeSec * 0.55 + f.phase * 0.7) * L * 0.025 * s * s;
      const lateral = wave + curve;
      f.spine.push([
        f.position[0] + f.forward[0] * longitudinal + f.side[0] * lateral,
        f.position[1] + f.forward[1] * longitudinal + f.side[1] * lateral,
        f.position[2] + f.forward[2] * longitudinal + f.side[2] * lateral,
      ]);
    }
    // Tail-beat phase slightly changes the sampled polyline length. Rescale around
    // the body centre so the known biological/fork axis length stays invariant.
    const arcM = this.spineArcLengthMm(f) / 1000;
    const wantedM = f.trueLengthMm / 1000;
    if (arcM > 1e-6 && Math.abs(arcM - wantedM) / wantedM > 0.0001) {
      const scale = wantedM / arcM;
      f.spine = f.spine.map((p) => [
        f.position[0] + (p[0] - f.position[0]) * scale,
        f.position[1] + (p[1] - f.position[1]) * scale,
        f.position[2] + (p[2] - f.position[2]) * scale,
      ]);
    }
  }

  private forwardSafe(f: Vec3): Vec3 {
    return Math.hypot(f[0], f[2]) < 0.01 ? [0, 0, 1] : f;
  }

  water(camDepth?: number): WaterState {
    return waterState(this.hour, camDepth ?? 2.5, this.tempC);
  }
}

function crossUp(f: Vec3): Vec3 {
  // UP × forward gives the fish lateral axis.
  return normalize([
    UP[1] * f[2] - UP[2] * f[1],
    UP[2] * f[0] - UP[0] * f[2],
    UP[0] * f[1] - UP[1] * f[0],
  ]);
}
function crossSafe(a: Vec3, b: Vec3): Vec3 {
  return normalize([
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]);
}

export function meanLengthForCage(cage: { stockingDate: string }, now = new Date('2026-11-27T10:00:00')): number {
  const days = Math.max(30, (now.getTime() - new Date(cage.stockingDate).getTime()) / 86400000);
  // Prototype growth curve: fast early growth, approaching asymptotic 430 mm.
  return 430 * (1 - Math.exp(-days / 118)) + 70 * Math.exp(-days / 40);
}

export function rigDepth(rig: CameraRig): number {
  return rig.installDepthM;
}
