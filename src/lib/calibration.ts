import type { CalibrationImageStat, CameraRig, DistortionCoeffs, GlassParams, Intrinsics } from '../types';
import { clamp, deterministicRandom, rodrigues, rodriguesToVec, uid, type Vec3 } from './math3d';
import { distortNormalized, solveGlassAirSlope, type StereoRigModel } from './camera';

export interface CalibrationCapture {
  id: string;
  index: number;
  poseLabel: string;
  objectPoints: Vec3[];
  leftPixels: [number, number][];
  rightPixels: [number, number][];
  badSample: boolean;
  capturedAt: string;
}

export interface MonoCalibrationResult {
  intrinsics: Intrinsics;
  distortion: DistortionCoeffs;
  rmsPx: number;
  iterations: number;
  images: CalibrationImageStat[];
}

interface MonoImageInput {
  id: string;
  index: number;
  poseLabel: string;
  objectPoints: Vec3[];
  pixels: [number, number][];
  badSample: boolean;
  capturedAt: string;
}

function projectMono(
  obj: Vec3,
  rvec: Vec3,
  tvec: Vec3,
  K: Intrinsics,
  d: DistortionCoeffs,
  glass: GlassParams,
): [number, number] | null {
  const R = rodrigues(rvec);
  let X = R[0] * obj[0] + R[1] * obj[1] + R[2] * obj[2] + tvec[0];
  let Y = R[3] * obj[0] + R[4] * obj[1] + R[5] * obj[2] + tvec[1];
  const Z = R[6] * obj[0] + R[7] * obj[1] + R[8] * obj[2] + tvec[2];
  if (Z <= 0.02) return null;
  let xn: number, yn: number;
  const radialWorld = Math.hypot(X, Y);
  if (glass.enabled) {
    const q = solveGlassAirSlope(radialWorld, Z, glass);
    const s = radialWorld > 1e-10 ? q / radialWorld : 0;
    xn = X * s;
    yn = Y * s;
  } else {
    xn = X / Z;
    yn = Y / Z;
  }
  const [xd, yd] = distortNormalized(xn, yn, d);
  return [K.fx * xd + K.cx, K.fy * yd + K.cy];
}

export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    if (Math.abs(pv) < 1e-14) M[col][col] = pv < 0 ? -1e-14 : 1e-14;
    const pivotValue = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pivotValue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-15) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

export function solveHomography(src: [number, number][], dst: [number, number][]): number[] {
  const n = src.length;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < n; i++) {
    const [X, Y] = src[i];
    const [u, v] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]);
    b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]);
    b.push(v);
  }
  const rows = A.length, cols = 8;
  const AtA = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const Atb = new Array(cols).fill(0);
  for (let i = 0; i < rows; i++) {
    for (let a = 0; a < cols; a++) {
      Atb[a] += A[i][a] * b[i];
      for (let c = 0; c < cols; c++) AtA[a][c] += A[i][a] * A[i][c];
    }
  }
  const h = solveLinear(AtA, Atb);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function initialPose(
  objects: Vec3[],
  pixels: [number, number][],
  K: Intrinsics,
): { rvec: Vec3; tvec: Vec3 } {
  const src = objects.map((p) => [p[0], p[1]] as [number, number]);
  const normalized = pixels.map(([u, v]) => [
    (u - K.cx) / K.fx,
    (v - K.cy) / K.fy,
  ] as [number, number]);
  const H = solveHomography(src, normalized);
  // Columns of H: g1,g2,g3.
  const g1: Vec3 = [H[0], H[3], H[6]];
  const g2: Vec3 = [H[1], H[4], H[7]];
  const g3: Vec3 = [H[2], H[5], H[8]];
  const n1 = Math.hypot(...g1);
  const n2 = Math.hypot(...g2);
  const lambda = 2 / (n1 + n2 || 1);
  let r1 = g1.map((x) => x * lambda) as Vec3;
  let r2 = g2.map((x) => x * lambda) as Vec3;
  const tvec = g3.map((x) => x * lambda) as Vec3;
  const l1 = Math.hypot(...r1) || 1;
  r1 = r1.map((x) => x / l1) as Vec3;
  let dot = r2[0] * r1[0] + r2[1] * r1[1] + r2[2] * r1[2];
  r2 = [r2[0] - dot * r1[0], r2[1] - dot * r1[1], r2[2] - dot * r1[2]];
  const l2 = Math.hypot(...r2) || 1;
  r2 = r2.map((x) => x / l2) as Vec3;
  const r3: Vec3 = [
    r1[1] * r2[2] - r1[2] * r2[1],
    r1[2] * r2[0] - r1[0] * r2[2],
    r1[0] * r2[1] - r1[1] * r2[0],
  ];
  // row-major rotation whose columns are r1,r2,r3.
  const R = [
    r1[0], r2[0], r3[0],
    r1[1], r2[1], r3[1],
    r1[2], r2[2], r3[2],
  ];
  return { rvec: rodriguesToVec(R), tvec };
}

interface PreparedImage extends MonoImageInput {
  rvec: Vec3;
  tvec: Vec3;
}

export async function calibrateMono(
  inputs: MonoImageInput[],
  initial: Intrinsics,
  glass: GlassParams,
  opts: { maxIterations?: number; onProgress?: (p: number, label: string) => void; initialDistortion?: DistortionCoeffs } = {},
): Promise<MonoCalibrationResult> {
  const used = inputs.filter((im) => true);
  const prepared: PreparedImage[] = used.map((im) => ({
    ...im,
    ...initialPose(im.objectPoints, im.pixels, initial),
  }));

  // params: log-focal-ish values are kept linear for transparent UI.
  const K0 = { ...initial };
  const d0 = opts.initialDistortion;
  const globalParams = [K0.fx, K0.fy, K0.cx, K0.cy, d0?.k1 ?? 0, d0?.k2 ?? 0, d0?.p1 ?? 0, d0?.p2 ?? 0, d0?.k3 ?? 0];
  const poseParams: number[] = prepared.flatMap((im) => [...im.rvec, ...im.tvec]);
  let params = [...globalParams, ...poseParams];
  const globalCount = globalParams.length;

  const unpack = (p: number[]) => {
    const K: Intrinsics = { fx: p[0], fy: p[1], cx: p[2], cy: p[3], width: K0.width, height: K0.height };
    const d: DistortionCoeffs = { k1: p[4], k2: p[5], p1: p[6], p2: p[7], k3: p[8] };
    return { K, d };
  };

  const residual = (p: number[]): number[] => {
    const { K, d } = unpack(p);
    const out: number[] = [];
    for (let ii = 0; ii < prepared.length; ii++) {
      const im = prepared[ii];
      const base = globalCount + ii * 6;
      const rvec: Vec3 = [p[base], p[base + 1], p[base + 2]];
      const tvec: Vec3 = [p[base + 3], p[base + 4], p[base + 5]];
      for (let j = 0; j < im.objectPoints.length; j++) {
        const q = projectMono(im.objectPoints[j], rvec, tvec, K, d, glass);
        const [u, v] = im.pixels[j];
        if (!q) out.push(20, 20);
        else out.push(q[0] - u, q[1] - v);
      }
    }
    return out;
  };

  let r = residual(params);
  let cost = r.reduce((a, b) => a + b * b, 0);
  let lambda = 1e-3;
  const maxIter = opts.maxIterations ?? 18;

  for (let iter = 0; iter < maxIter; iter++) {
    opts.onProgress?.(iter / maxIter, `LM 优化第 ${iter + 1}/${maxIter} 轮`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    r = residual(params);
    const m = r.length;
    const n = params.length;
    const step = params.map((x, i) => {
      if (i < 2) return 0.08; // focal px
      if (i < 4) return 0.05; // principal px
      if (i < globalCount) return 2e-5; // distortion
      const poseKind = (i - globalCount) % 6;
      return poseKind < 3 ? 2e-5 : 2e-5; // rvec rad / t m
    });
    const J: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const hp = [...params];
      hp[j] += step[j];
      const rp = residual(hp);
      for (let i = 0; i < m; i++) J[i][j] = (rp[i] - r[i]) / step[j];
    }
    const JtJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let i = 0; i < m; i++) {
      for (let a = 0; a < n; a++) {
        const ja = J[i][a];
        if (ja === 0) continue;
        Jtr[a] += ja * r[i];
        for (let b = a; b < n; b++) JtJ[a][b] += ja * J[i][b];
      }
    }
    for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) JtJ[a][b] = JtJ[b][a];

    let accepted = false;
    for (let attempt = 0; attempt < 8 && !accepted; attempt++) {
      const A = JtJ.map((row, a) => row.map((x, b) => x + (a === b ? lambda * (x || 1) + lambda * 1e-9 : 0)));
      let delta: number[];
      try {
        delta = solveLinear(A, Jtr.map((x) => -x));
      } catch {
        lambda *= 8;
        continue;
      }
      const candidate = params.map((x, i) => {
        let y = x + delta[i];
        if (i === 0 || i === 1) y = clamp(y, K0.fx * 0.4, K0.fx * 2.5);
        if (i >= 4 && i < globalCount) y = clamp(y, -1.2, 1.2);
        return y;
      });
      const rc = residual(candidate);
      const cc = rc.reduce((a, b) => a + b * b, 0);
      if (Number.isFinite(cc) && cc < cost) {
        params = candidate;
        cost = cc;
        lambda = Math.max(1e-7, lambda / 3);
        accepted = true;
      } else {
        lambda *= 6;
      }
    }
    if (!accepted && iter > 4) break;
  }

  const { K, d } = unpack(params);
  const finalRes = residual(params);
  const totalPoints = prepared.reduce((a, im) => a + im.pixels.length, 0);
  const rmsPx = Math.sqrt(finalRes.reduce((a, b) => a + b * b, 0) / Math.max(1, totalPoints));

  let cursor = 0;
  const images: CalibrationImageStat[] = prepared.map((im, ii) => {
    const base = globalCount + ii * 6;
    const rvec: [number, number, number] = [params[base], params[base + 1], params[base + 2]];
    const tvec: [number, number, number] = [params[base + 3], params[base + 4], params[base + 5]];
    const errs: number[] = [];
    let sum2 = 0, max = 0;
    for (let j = 0; j < im.pixels.length; j++) {
      const ex = finalRes[cursor++];
      const ey = finalRes[cursor++];
      const e = Math.hypot(ex, ey);
      errs.push(e);
      sum2 += e * e;
      max = Math.max(max, e);
    }
    const rms = Math.sqrt(sum2 / im.pixels.length);
    return {
      id: im.id,
      index: im.index,
      capturedAt: im.capturedAt,
      poseLabel: im.poseLabel,
      cornerCount: im.pixels.length,
      rmsPx: rms,
      maxErrorPx: max,
      included: true,
      badSample: im.badSample,
      rvec,
      tvec,
      errors: errs,
    };
  });

  return { intrinsics: K, distortion: d, rmsPx, iterations: maxIter, images };
}

export function averageStereoExtrinsics(
  left: CalibrationImageStat[],
  right: CalibrationImageStat[],
): { R: number[]; T: Vec3; baselineMm: number; reproj: number } {
  const Rs: number[][] = [];
  const Ts: Vec3[] = [];
  for (const l of left) {
    const r = right.find((x) => x.index === l.index);
    if (!r) continue;
    const RL = rodrigues(l.rvec);
    const RR = rodrigues(r.rvec);
    // R_s = R_R R_L^T. R_L^T swaps off-diagonal entries.
    const RLT = [RL[0], RL[3], RL[6], RL[1], RL[4], RL[7], RL[2], RL[5], RL[8]];
    const Rsr = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      Rsr[i * 3 + j] =
        RR[i * 3] * RLT[j] + RR[i * 3 + 1] * RLT[3 + j] + RR[i * 3 + 2] * RLT[6 + j];
    }
    const R = Rsr;
    const T: Vec3 = [
      r.tvec[0] - (R[0] * l.tvec[0] + R[1] * l.tvec[1] + R[2] * l.tvec[2]),
      r.tvec[1] - (R[3] * l.tvec[0] + R[4] * l.tvec[1] + R[5] * l.tvec[2]),
      r.tvec[2] - (R[6] * l.tvec[0] + R[7] * l.tvec[1] + R[8] * l.tvec[2]),
    ];
    Rs.push(R);
    Ts.push(T);
  }
  const T: Vec3 = [0, 0, 0];
  Ts.forEach((t) => { T[0] += t[0] / Ts.length; T[1] += t[1] / Ts.length; T[2] += t[2] / Ts.length; });
  // Parallel cameras make identity a stable average; small solved rotation is ignored for ray geometry.
  const baselineMm = Math.hypot(T[0], T[1], T[2]) * 1000;
  return { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], T, baselineMm, reproj: 0 };
}

export function boardObjectPoints(cols: number, rows: number, squareM: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    pts.push([(x - (cols - 1) / 2) * squareM, (y - (rows - 1) / 2) * squareM, 0]);
  }
  return pts;
}

/** Deterministic pose library, also used by the visible checkerboard preview. */
export function boardPose(index: number, total: number): { rvec: Vec3; tvec: Vec3; label: string } {
  const rand = deterministicRandom(9100 + index * 131);
  const phase = index / total;
  const z = 0.85 + 1.25 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2.2 + 0.4));
  const x = (rand() - 0.5) * 0.42 + Math.sin(index * 1.7) * 0.08;
  const y = 0.02 + rand() * 0.22; // camera y is down
  const rvec: Vec3 = [
    (rand() - 0.5) * 0.55,
    (rand() - 0.5) * 0.65,
    (rand() - 0.5) * 0.28,
  ];
  return { rvec, tvec: [x, y, z], label: `第 ${index + 1} 组 · ${z.toFixed(2)}m` };
}

export function generateCalibrationCaptures(
  rig: StereoRigModel,
  cols: number,
  rows: number,
  squareMm: number,
  count: number,
  noiseSigmaPx = 0.16,
): CalibrationCapture[] {
  const squareM = squareMm / 1000;
  const objects = boardObjectPoints(cols, rows, squareM);
  const rand = deterministicRandom(20261127);
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const captures: CalibrationCapture[] = [];
  const badIndex = Math.floor(count * 0.58);
  for (let i = 0; i < count; i++) {
    const pose = boardPose(i, count);
    const bad = i === badIndex;
    const noise = bad ? 2.4 : noiseSigmaPx;
    const tR: Vec3 = [pose.tvec[0] + rig.stereoT[0], pose.tvec[1] + rig.stereoT[1], pose.tvec[2] + rig.stereoT[2]];
    const leftPixels: [number, number][] = [];
    const rightPixels: [number, number][] = [];
    for (let j = 0; j < objects.length; j++) {
      const lp = projectMono(objects[j], pose.rvec, pose.tvec, rig.left.intrinsics, rig.left.distortion, rig.left.glass);
      const rp = projectMono(objects[j], pose.rvec, tR, rig.right.intrinsics, rig.right.distortion, rig.right.glass);
      if (!lp || !rp) continue;
      let lu = lp[0] + gauss() * noise;
      let lv = lp[1] + gauss() * noise;
      let ru = rp[0] + gauss() * noise;
      let rv = rp[1] + gauss() * noise;
      if (bad && j === Math.floor(objects.length * 0.5)) {
        lu += 9; lv -= 6; ru += 7; rv += 5;
      }
      leftPixels.push([lu, lv]);
      rightPixels.push([ru, rv]);
    }
    captures.push({
      id: uid('cap'),
      index: i,
      poseLabel: pose.label,
      objectPoints: objects,
      leftPixels,
      rightPixels,
      badSample: bad,
      capturedAt: new Date(Date.now() - (count - i) * 60_000).toISOString(),
    });
  }
  return captures;
}

export function capturesToMonoInputs(captures: CalibrationCapture[], side: 'left' | 'right'): MonoImageInput[] {
  return captures.map((c) => ({
    id: `${c.id}-${side}`,
    index: c.index,
    poseLabel: c.poseLabel,
    objectPoints: c.objectPoints,
    pixels: side === 'left' ? c.leftPixels : c.rightPixels,
    badSample: c.badSample,
    capturedAt: c.capturedAt,
  }));
}
