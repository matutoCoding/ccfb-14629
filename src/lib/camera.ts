import type { BiasParams, CameraRig, DistortionCoeffs, GlassParams, Intrinsics } from '../types';
import { clamp, cross, deterministicRandom, dot, normalize, rodrigues, sub, type Vec3 } from './math3d';

export interface CameraModel {
  id: string;
  label: string;
  side: 'L' | 'R';
  width: number;
  height: number;
  intrinsics: Intrinsics;
  distortion: DistortionCoeffs;
  glass: GlassParams;
  eye: Vec3;
  right: Vec3;
  down: Vec3;
  forward: Vec3;
  /** row-major world->camera rotation [right; down; forward] */
  rotation: number[];
}

export interface StereoRigModel {
  rigId: string;
  cageId: string;
  left: CameraModel;
  right: CameraModel;
  baselineM: number;
  /** right-from-left rotation, translation in m */
  stereoR: number[];
  stereoT: Vec3;
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function focalPixels(rig: Pick<CameraRig, 'focalLengthMm' | 'sensorWidthMm' | 'width'>): number {
  return (rig.focalLengthMm / rig.sensorWidthMm) * rig.width;
}

export function baseIntrinsics(rig: CameraRig): Intrinsics {
  const fx = focalPixels(rig);
  return {
    fx,
    fy: fx,
    cx: rig.width * rig.principalPointXRatio,
    cy: rig.height * rig.principalPointYRatio,
    width: rig.width,
    height: rig.height,
  };
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angleRad: number): Vec3 {
  // Rodrigues rotation of vector v around unit axis
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  const a = normalize(axis);
  const av = cross(a, v);
  const ad = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  return [
    v[0] * c + av[0] * s + a[0] * ad * (1 - c),
    v[1] * c + av[1] * s + a[1] * ad * (1 - c),
    v[2] * c + av[2] * s + a[2] * ad * (1 - c),
  ];
}

export function rigEyeBasis(rig: CameraRig, cageRadiusM: number): { eye: Vec3; forward: Vec3; right: Vec3; down: Vec3 } {
  const az = (rig.mountAzimuthDeg * Math.PI) / 180;
  const mountR = cageRadiusM * 0.98;
  const eye: Vec3 = [mountR * Math.cos(az), -rig.installDepthM, mountR * Math.sin(az)];
  // Points from perimeter toward cage centre.
  let forward: Vec3 = normalize([-Math.cos(az), 0, -Math.sin(az)]);
  // Recorded yaw is a pan offset around vertical.
  if (rig.yawDeg) forward = rotateAroundAxis(forward, [0, 1, 0], (rig.yawDeg * Math.PI) / 180);
  let right = normalize(cross(forward, [0, 1, 0]));
  // Positive pitch means looking downward.
  if (rig.pitchDeg) forward = normalize(rotateAroundAxis(forward, right, (-rig.pitchDeg * Math.PI) / 180));
  right = normalize(cross(forward, [0, 1, 0]));
  let down = cross(forward, right);
  if (rig.rollDeg) {
    const roll = (rig.rollDeg * Math.PI) / 180;
    right = normalize(rotateAroundAxis(right, forward, roll));
    down = normalize(rotateAroundAxis(down, forward, roll));
  }
  return { eye, forward, right, down };
}

interface CameraOverrides {
  intrinsics?: Intrinsics;
  distortion?: DistortionCoeffs;
  glass?: GlassParams;
  baselineM?: number;
  bias?: BiasParams;
  idPrefix?: string;
}

export function makeStereoRig(
  rig: CameraRig,
  cageRadiusM: number,
  overrides: CameraOverrides = {},
): StereoRigModel {
  const basis = rigEyeBasis(rig, cageRadiusM);
  const trueBaselineM = rig.baselineMm / 1000;
  const nominalBaselineM = overrides.baselineM ?? trueBaselineM;
  const baselineM = nominalBaselineM * (1 + (overrides.bias?.baselinePct ?? 0) / 100);
  const baseK = overrides.intrinsics ?? baseIntrinsics(rig);
  const bias = overrides.bias ?? rig.bias;
  const k: Intrinsics = {
    ...baseK,
    fx: baseK.fx * (1 + bias.focalPct / 100),
    fy: baseK.fy * (1 + bias.focalPct / 100),
  };
  const d: DistortionCoeffs = {
    ...(overrides.distortion ?? rig.trueDistortion),
    k1: (overrides.distortion ?? rig.trueDistortion).k1 + (bias.k1 ?? 0),
  };
  const glass = overrides.glass ?? rig.glass;
  const makeCam = (side: 'L' | 'R'): CameraModel => {
    const sign = side === 'L' ? -0.5 : 0.5;
    const eye: Vec3 = [
      basis.eye[0] + basis.right[0] * baselineM * sign,
      basis.eye[1] + basis.right[1] * baselineM * sign,
      basis.eye[2] + basis.right[2] * baselineM * sign,
    ];
    return {
      id: `${overrides.idPrefix ?? rig.id}:${side}`,
      label: side === 'L' ? '左目' : '右目',
      side,
      width: rig.width,
      height: rig.height,
      intrinsics: k,
      distortion: d,
      glass,
      eye,
      right: basis.right,
      down: basis.down,
      forward: basis.forward,
      rotation: [
        basis.right[0], basis.right[1], basis.right[2],
        basis.down[0], basis.down[1], basis.down[2],
        basis.forward[0], basis.forward[1], basis.forward[2],
      ],
    };
  };
  const left = makeCam('L');
  const right = makeCam('R');
  // p_right = R_stereo p_left + T. Parallel cameras: R=I, T=[-B,0,0].
  const stereoT: Vec3 = [-baselineM, 0, 0];
  return { rigId: rig.id, cageId: rig.cageId, left, right, baselineM, stereoR: IDENTITY, stereoT };
}

export function worldToCamera(p: Vec3, cam: CameraModel): Vec3 {
  const q = sub(p, cam.eye);
  return [
    q[0] * cam.right[0] + q[1] * cam.right[1] + q[2] * cam.right[2],
    q[0] * cam.down[0] + q[1] * cam.down[1] + q[2] * cam.down[2],
    q[0] * cam.forward[0] + q[1] * cam.forward[1] + q[2] * cam.forward[2],
  ];
}

function glassRadiusForAngle(thetaAir: number, Z: number, g: GlassParams): number {
  const ta = Math.tan(thetaAir);
  const sinA = Math.sin(thetaAir);
  const tg = Math.tan(Math.asin(clamp(sinA / g.iorGlass, -0.98, 0.98)));
  const tw = Math.tan(Math.asin(clamp(sinA / g.iorWater, -0.98, 0.98)));
  const zOuter = g.airGapM + g.thicknessM;
  return g.airGapM * ta + g.thicknessM * tg + Math.max(0, Z - zOuter) * tw;
}

/** Solve the air-side ray angle that reaches world radius R at camera depth Z. */
export function solveGlassAirSlope(R: number, Z: number, g: GlassParams): number {
  if (!g.enabled || Z <= g.airGapM + g.thicknessM) return R / Math.max(Z, 1e-6);
  if (R < 1e-10) return 0;
  let lo = 0;
  let hi = Math.min(1.35, Math.atan((R / Z) * g.iorWater + 0.25));
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (glassRadiusForAngle(mid, Z, g) < R) lo = mid;
    else hi = mid;
  }
  return Math.tan((lo + hi) / 2);
}

export function distortNormalized(x: number, y: number, d: DistortionCoeffs): [number, number] {
  const r2 = x * x + y * y;
  const r4 = r2 * r2;
  const r6 = r4 * r2;
  const radial = 1 + d.k1 * r2 + d.k2 * r4 + d.k3 * r6;
  const xd = x * radial + 2 * d.p1 * x * y + d.p2 * (r2 + 2 * x * x);
  const yd = y * radial + d.p1 * (r2 + 2 * y * y) + 2 * d.p2 * x * y;
  return [xd, yd];
}

export interface ProjectedPoint {
  u: number;
  v: number;
  z: number;
  inside: boolean;
  normalized: [number, number];
}

export function projectCamera(p: Vec3, cam: CameraModel, margin = 0): ProjectedPoint | null {
  const c = worldToCamera(p, cam);
  if (c[2] <= 0.05) return null;
  const R = Math.hypot(c[0], c[1]);
  let xn: number, yn: number;
  if (cam.glass.enabled) {
    const q = solveGlassAirSlope(R, c[2], cam.glass);
    const s = R > 1e-10 ? q / R : 0;
    xn = c[0] * s;
    yn = c[1] * s;
  } else {
    xn = c[0] / c[2];
    yn = c[1] / c[2];
  }
  const [xd, yd] = distortNormalized(xn, yn, cam.distortion);
  const u = cam.intrinsics.fx * xd + cam.intrinsics.cx;
  const v = cam.intrinsics.fy * yd + cam.intrinsics.cy;
  const inside =
    u >= -margin && u <= cam.width + margin && v >= -margin && v <= cam.height + margin;
  return { u, v, z: c[2], inside, normalized: [xd, yd] };
}

export function projectStereo(p: Vec3, rig: StereoRigModel) {
  return { L: projectCamera(p, rig.left), R: projectCamera(p, rig.right) };
}

export function undistortNormalized(u: number, v: number, cam: CameraModel): [number, number] {
  const x0 = (u - cam.intrinsics.cx) / cam.intrinsics.fx;
  const y0 = (v - cam.intrinsics.cy) / cam.intrinsics.fy;
  let x = x0, y = y0;
  const d = cam.distortion;
  for (let i = 0; i < 14; i++) {
    const r2 = x * x + y * y;
    const r4 = r2 * r2;
    const r6 = r4 * r2;
    const radial = 1 + d.k1 * r2 + d.k2 * r4 + d.k3 * r6;
    const xNew = (x0 - 2 * d.p1 * x * y - d.p2 * (r2 + 2 * x * x)) / radial;
    const yNew = (y0 - d.p1 * (r2 + 2 * y * y) - 2 * d.p2 * x * y) / radial;
    if (Math.abs(xNew - x) + Math.abs(yNew - y) < 1e-11) {
      x = xNew; y = yNew; break;
    }
    x = xNew; y = yNew;
  }
  return [x, y];
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

export function pixelToWaterRay(u: number, v: number, cam: CameraModel): Ray {
  const [qx, qy] = undistortNormalized(u, v, cam);
  const q = Math.hypot(qx, qy);
  const g = cam.glass;
  let oCam: Vec3 = [0, 0, 0];
  let dCam: Vec3;
  if (g.enabled && q > 1e-10) {
    const thetaA = Math.atan(q);
    const thetaG = Math.asin(clamp(Math.sin(thetaA) / g.iorGlass, -0.98, 0.98));
    const thetaW = Math.asin(clamp(Math.sin(thetaA) / g.iorWater, -0.98, 0.98));
    const qg = Math.tan(thetaG);
    const qw = Math.tan(thetaW);
    const zg = g.airGapM + g.thicknessM;
    oCam = [
      g.airGapM * qx + g.thicknessM * (qx * qg / q),
      g.airGapM * qy + g.thicknessM * (qy * qg / q),
      zg,
    ];
    dCam = [qx * qw / q, qy * qw / q, 1];
  } else {
    dCam = [qx, qy, 1];
  }
  const origin: Vec3 = [
    cam.eye[0] + cam.right[0] * oCam[0] + cam.down[0] * oCam[1] + cam.forward[0] * oCam[2],
    cam.eye[1] + cam.right[1] * oCam[0] + cam.down[1] * oCam[1] + cam.forward[1] * oCam[2],
    cam.eye[2] + cam.right[2] * oCam[0] + cam.down[2] * oCam[1] + cam.forward[2] * oCam[2],
  ];
  const dir = normalize([
    cam.right[0] * dCam[0] + cam.down[0] * dCam[1] + cam.forward[0] * dCam[2],
    cam.right[1] * dCam[0] + cam.down[1] * dCam[1] + cam.forward[1] * dCam[2],
    cam.right[2] * dCam[0] + cam.down[2] * dCam[1] + cam.forward[2] * dCam[2],
  ]);
  return { origin, dir };
}

/** Closest midpoint between skew rays. Returns point and ray-miss distance m. */
export function triangulateRays(a: Ray, b: Ray): { point: Vec3; missM: number } {
  const da = normalize(a.dir);
  const db = normalize(b.dir);
  const w0 = sub(a.origin, b.origin);
  const aa = dot(da, da);
  const bb = dot(db, db);
  const ab = dot(da, db);
  const ad = dot(da, w0);
  const bd = dot(db, w0);
  const denom = aa * bb - ab * ab;
  let s: number, t: number;
  if (Math.abs(denom) < 1e-10) {
    s = 0;
    t = bd / bb;
  } else {
    s = (ab * bd - bb * ad) / denom;
    t = (aa * bd - ab * ad) / denom;
  }
  s = clamp(s, -20, 20);
  t = clamp(t, -20, 20);
  const pa: Vec3 = [a.origin[0] + da[0] * s, a.origin[1] + da[1] * s, a.origin[2] + da[2] * s];
  const pb: Vec3 = [b.origin[0] + db[0] * t, b.origin[1] + db[1] * t, b.origin[2] + db[2] * t];
  const point: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
  return { point, missM: Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) };
}

export function triangulatePixels(leftPx: [number, number], rightPx: [number, number], rig: StereoRigModel) {
  const rayL = pixelToWaterRay(leftPx[0], leftPx[1], rig.left);
  const rayR = pixelToWaterRay(rightPx[0], rightPx[1], rig.right);
  const { point, missM } = triangulateRays(rayL, rayR);
  const pL = projectCamera(point, rig.left);
  const pR = projectCamera(point, rig.right);
  const reproj =
    pL && pR
      ? Math.hypot(pL.u - leftPx[0], pL.v - leftPx[1]) +
        Math.hypot(pR.u - rightPx[0], pR.v - rightPx[1])
      : 999;
  return { point, missM, reprojErrorPx: reproj / 2 };
}

/** Sample the generalized epipolar curve in `targetCam` for a point in `sourceCam`. */
export function epipolarCurve(
  sourcePx: [number, number],
  sourceCam: CameraModel,
  targetCam: CameraModel,
  samples = 72,
): [number, number][] {
  const ray = pixelToWaterRay(sourcePx[0], sourcePx[1], sourceCam);
  const pts: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const depth = 0.35 + (i / (samples - 1)) * 17.5;
    const p: Vec3 = [
      ray.origin[0] + ray.dir[0] * depth,
      ray.origin[1] + ray.dir[1] * depth,
      ray.origin[2] + ray.dir[2] * depth,
    ];
    const q = projectCamera(p, targetCam);
    if (q) pts.push([q.u, q.v]);
  }
  return pts;
}

export function distanceToPolyline(px: [number, number], line: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = px[0] - a[0], wy = px[1] - a[1];
    const c1 = vx * wx + vy * wy;
    const c2 = vx * vx + vy * vy;
    const t = c2 > 0 ? clamp(c1 / c2, 0, 1) : 0;
    const x = a[0] + vx * t, y = a[1] + vy * t;
    best = Math.min(best, Math.hypot(px[0] - x, px[1] - y));
  }
  return best;
}

export function addPixelNoise(p: [number, number], sigmaPx: number, seed: number): [number, number] {
  if (sigmaPx <= 0) return p;
  const rand = deterministicRandom(seed);
  // Box-Muller-ish via gaussian imported indirectly would create cycle? use local.
  const g = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return [p[0] + g() * sigmaPx, p[1] + g() * sigmaPx];
}

export function rotationFromRvec(rvec: [number, number, number]) {
  return rodrigues(rvec);
}
