import type { MeasurementRecord, Settings } from '../types';
import {
  addPixelNoise,
  distanceToPolyline,
  epipolarCurve,
  projectCamera,
  triangulatePixels,
  type StereoRigModel,
} from '../lib/camera';
import { dot } from '../lib/math3d';
import type { FishWorld, SimFish } from './world';
import { weightFromLength } from '../lib/growth';
import { solveLinear } from '../lib/calibration';

export interface CandidateKeypoint {
  fishId: string;
  spineIndex: number;
  kind: 'snout' | 'axis' | 'tail';
  left: [number, number];
  right: [number, number];
}

export interface FishEvaluation {
  fish: SimFish;
  eligible: boolean;
  reasons: string[];
  obliqueDeg: number;
  occlusionPct: number;
  fullVisible: boolean;
  confidence: number;
  marginPx: number;
}

export type MeasurementDraft = Omit<MeasurementRecord, 'id' | 'measuredAt'> & { measuredAt?: string };

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const c1 = vx * wx + vy * wy;
  const c2 = vx * vx + vy * vy;
  const t = c2 > 0 ? Math.max(0, Math.min(1, c1 / c2)) : 0;
  const x = ax + vx * t, y = ay + vy * t;
  return Math.hypot(px - x, py - y);
}

export function buildKeypointCandidates(world: FishWorld, renderRig: StereoRigModel, noisePx: number, nonce: number): CandidateKeypoint[] {
  const out: CandidateKeypoint[] = [];
  world.fishes.forEach((fish, fi) => {
    fish.spine.forEach((p, i) => {
      const pl = projectCamera(p, renderRig.left);
      const pr = projectCamera(p, renderRig.right);
      if (!pl || !pr) return;
      const seed = fish.seed + i * 131 + nonce * 1009 + fi * 17;
      const left = addPixelNoise([pl.u, pl.v], noisePx, seed);
      const right = addPixelNoise([pr.u, pr.v], noisePx, seed + 991);
      out.push({
        fishId: fish.id,
        spineIndex: i,
        kind: i === 0 ? 'snout' : i === fish.spine.length - 1 ? 'tail' : 'axis',
        left,
        right,
      });
    });
  });
  return out;
}

export function evaluateFish(world: FishWorld, fish: SimFish, renderRig: StereoRigModel, settings: Settings): FishEvaluation {
  const reasons: string[] = [];
  const projections = fish.spine.map((p) => ({
    l: projectCamera(p, renderRig.left),
    r: projectCamera(p, renderRig.right),
  }));
  const allProjected = projections.every((p) => p.l && p.r);
  const margin = 26;
  let minMargin = 999;
  let fullVisible = false;
  if (allProjected) {
    fullVisible = projections.every(({ l, r }) => {
      const ml = Math.min(l!.u, l!.v, renderRig.left.width - l!.u, renderRig.left.height - l!.v);
      const mr = Math.min(r!.u, r!.v, renderRig.right.width - r!.u, renderRig.right.height - r!.v);
      minMargin = Math.min(minMargin, ml, mr);
      return ml > margin && mr > margin;
    });
  }
  if (!allProjected) reasons.push('未进入双目共同视场');
  else if (!fullVisible) reasons.push('鱼身或尾鳍贴边');

  const depthComponent = Math.abs(dot(fish.forward, renderRig.left.forward));
  const obliqueDeg = (Math.asin(Math.min(1, depthComponent)) * 180) / Math.PI;
  if (obliqueDeg > settings.maxObliqueDeg) reasons.push(`斜角 ${obliqueDeg.toFixed(0)}° 过大`);

  // Occlusion: another fish's spine projected within body radius and closer to lens.
  let blocked = 0;
  let tested = 0;
  for (let i = 0; i < fish.spine.length; i++) {
    const q = projections[i]?.l;
    if (!q) continue;
    tested++;
    for (const other of world.fishes) {
      if (other.id === fish.id) continue;
      const oq = other.spine.map((p) => projectCamera(p, renderRig.left)).filter(Boolean) as NonNullable<ReturnType<typeof projectCamera>>[];
      for (let j = 1; j < oq.length; j++) {
        const d = pointSegmentDistance(q.u, q.v, oq[j - 1].u, oq[j - 1].v, oq[j].u, oq[j].v);
        if (d < 13 + (i === 0 || i === fish.spine.length - 1 ? 2 : 5) && oq[j].z < q.z - 0.18) {
          blocked++;
          break;
        }
      }
      if (blocked > i) break;
    }
  }
  const occlusionPct = tested ? (blocked / tested) * 100 : 100;
  if (occlusionPct > 22) reasons.push(`遮挡 ${occlusionPct.toFixed(0)}%`);

  let confidence = 0.98;
  confidence -= Math.min(0.3, (obliqueDeg / settings.maxObliqueDeg) * 0.24);
  confidence -= Math.min(0.5, (occlusionPct / 100) * 0.55);
  confidence -= fullVisible ? 0 : 0.28;
  confidence -= Math.max(0, (margin * 0.4 - minMargin) / 100) * 0.12;
  confidence = Math.max(0.05, Math.min(0.99, confidence));
  if (confidence < settings.confidenceThreshold) reasons.push(`可信度 ${confidence.toFixed(2)} 低于阈值`);

  return { fish, eligible: reasons.length === 0, reasons, obliqueDeg, occlusionPct, fullVisible, confidence, marginPx: minMargin };
}

function fitPolynomial(values: number[], degree: number): (t: number) => number {
  const n = values.length;
  const d = Math.min(degree, n - 1);
  // Weighted least squares with endpoint emphasis: snout/tail define the measured span.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const w = 1;
    const row: number[] = [];
    for (let k = 0; k <= d; k++) row.push(w * Math.pow(t, k));
    A.push(row);
    b.push(values[i] * w);
  }
  const cols = d + 1;
  const AtA = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const Atb = new Array(cols).fill(0);
  for (let i = 0; i < A.length; i++) {
    for (let a = 0; a < cols; a++) {
      Atb[a] += A[i][a] * b[i];
      for (let c = 0; c < cols; c++) AtA[a][c] += A[i][a] * A[i][c];
    }
  }
  const coef = solveLinear(AtA, Atb);
  return (t: number) => coef.reduce((sum, c, k) => sum + c * Math.pow(t, k), 0);
}

/**
 * Triangulated axis points have depth noise that dominates 3–5 cm raw segments.
 * A cubic centerline fit averages that noise while retaining the tail bend,
 * then arc length is integrated on a dense resampling.
 */
export function smoothedAxisLengthMm(points: [number, number, number][]): { lengthMm: number; dense: [number, number, number][] } {
  if (points.length < 4) {
    let lengthMm = 0;
    for (let i = 1; i < points.length; i++) lengthMm += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]) * 1000;
    return { lengthMm, dense: points };
  }
  const fx = fitPolynomial(points.map((p) => p[0]), 2);
  const fy = fitPolynomial(points.map((p) => p[1]), 2);
  const fz = fitPolynomial(points.map((p) => p[2]), 2);
  const dense: [number, number, number][] = [];
  const samples = 48;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    dense.push([fx(t), fy(t), fz(t)]);
  }
  let lengthMm = 0;
  for (let i = 1; i < dense.length; i++) {
    lengthMm += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1], dense[i][2] - dense[i - 1][2]) * 1000;
  }
  return { lengthMm, dense };
}

export function measureCandidateAxis(input: {
  fish: SimFish;
  renderRig: StereoRigModel;
  measureRig: StereoRigModel;
  settings: Settings;
  nonce: number;
  evaluation?: FishEvaluation;
  calibrationId?: string | null;
  biased?: boolean;
  rigId: string;
  cageId: string;
  method: 'manual' | 'auto';
  leftPoints?: [number, number][];
  rightPoints?: [number, number][];
  segmentCount?: number;
}): MeasurementDraft | null {
  const { fish, renderRig, measureRig, settings, nonce } = input;
  const nSegments = input.segmentCount ?? 6;
  const leftPx: [number, number][] = [];
  const rightPx: [number, number][] = [];
  const points3D = [] as [number, number, number][];
  let reprojSum = 0;
  let epipolarSum = 0;
  let misses = 0;

  for (let s = 0; s <= nSegments; s++) {
    const idx = Math.round((s / nSegments) * (fish.spine.length - 1));
    const p = fish.spine[idx];
    if (input.leftPoints?.[s] && input.rightPoints?.[s]) {
      leftPx.push(input.leftPoints[s]);
      rightPx.push(input.rightPoints[s]);
    } else {
      const pl = projectCamera(p, renderRig.left);
      const pr = projectCamera(p, renderRig.right);
      if (!pl || !pr) return null;
      const seed = fish.seed + idx * 173 + nonce * 101;
      leftPx.push(addPixelNoise([pl.u, pl.v], settings.measurementNoisePx, seed));
      rightPx.push(addPixelNoise([pr.u, pr.v], settings.measurementNoisePx, seed + 777));
    }
    const tri = triangulatePixels(leftPx[s], rightPx[s], measureRig);
    points3D.push(tri.point);
    reprojSum += tri.reprojErrorPx;
    if (tri.missM > 0.08) misses++;
    const curve = epipolarCurve(leftPx[s], measureRig.left, measureRig.right);
    epipolarSum += distanceToPolyline(rightPx[s], curve);
  }

  const segments = points3D.slice(1).map((b, i) => {
    const a = points3D[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 1000;
    return { a, b, lengthMm: len, leftA: leftPx[i], leftB: leftPx[i + 1], rightA: rightPx[i], rightB: rightPx[i + 1] };
  });
  const { lengthMm } = smoothedAxisLengthMm(points3D);
  if (misses > nSegments / 2) return null;

  const trueLength = fish.trueLengthMm;
  const errorMm = lengthMm - trueLength;
  const errorPct = (errorMm / trueLength) * 100;
  const weightG = weightFromLength(lengthMm, settings.season, settings);
  const ev = input.evaluation;
  return {
    cageId: input.cageId,
    rigId: input.rigId,
    method: input.method,
    forkLengthMm: lengthMm,
    weightG,
    confidence: ev?.confidence ?? 0.9,
    season: settings.season,
    waterTempC: settings.waterTempC,
    segmentCount: nSegments,
    reprojErrorPx: reprojSum / (nSegments + 1),
    leftSnout: leftPx[0],
    leftTail: leftPx[leftPx.length - 1],
    rightSnout: rightPx[0],
    rightTail: rightPx[rightPx.length - 1],
    epipolarErrorPx: epipolarSum / (nSegments + 1),
    obliqueDeg: ev?.obliqueDeg ?? 0,
    occlusionPct: ev?.occlusionPct ?? 0,
    truthFishId: fish.id,
    trueLengthMm: trueLength,
    errorMm,
    errorPct,
    lengthWeightA: settings.lengthWeight[settings.season].a,
    lengthWeightB: settings.lengthWeight[settings.season].b,
    calibrationId: input.calibrationId ?? null,
    biased: input.biased ?? false,
    segments,
  };
}

export function autoMeasureWorld(input: {
  world: FishWorld;
  renderRig: StereoRigModel;
  measureRig: StereoRigModel;
  settings: Settings;
  rigId: string;
  cageId: string;
  calibrationId?: string | null;
  biased?: boolean;
  nonce: number;
  maxFish?: number;
}): { drafts: MeasurementDraft[]; evaluations: FishEvaluation[] } {
  const evaluations = input.world.fishes.map((f) => evaluateFish(input.world, f, input.renderRig, input.settings));
  const eligible = evaluations.filter((e) => e.eligible).sort((a, b) => b.confidence - a.confidence).slice(0, input.maxFish ?? 8);
  const drafts: MeasurementDraft[] = [];
  eligible.forEach((ev, i) => {
    const draft = measureCandidateAxis({
      fish: ev.fish,
      renderRig: input.renderRig,
      measureRig: input.measureRig,
      settings: input.settings,
      nonce: input.nonce + i * 37,
      evaluation: ev,
      calibrationId: input.calibrationId,
      biased: input.biased,
      rigId: input.rigId,
      cageId: input.cageId,
      method: 'auto',
      segmentCount: ev.fish.spine.length - 1,
    });
    if (draft) drafts.push(draft);
  });
  return { drafts, evaluations };
}

export function snapLeftCandidate(px: [number, number], candidates: CandidateKeypoint[], maxPx = 22): CandidateKeypoint | null {
  let best: CandidateKeypoint | null = null;
  let bd = maxPx;
  for (const c of candidates) {
    const d = Math.hypot(c.left[0] - px[0], c.left[1] - px[1]);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

export function matchRightAlongEpipolar(input: {
  leftPx: [number, number];
  measureRig: StereoRigModel;
  candidates: CandidateKeypoint[];
  fishId?: string;
  spineIndex?: number;
  maxEpipolarPx?: number;
}): { point: [number, number]; candidate: CandidateKeypoint; epipolarPx: number } | null {
  const curve = epipolarCurve(input.leftPx, input.measureRig.left, input.measureRig.right);
  let best: { point: [number, number]; candidate: CandidateKeypoint; epipolarPx: number } | null = null;
  let bestScore = input.maxEpipolarPx ?? 24;
  for (const c of input.candidates) {
    if (input.fishId && c.fishId !== input.fishId) continue;
    const epi = distanceToPolyline(c.right, curve);
    const indexPenalty = input.spineIndex === undefined ? 0 : Math.abs(c.spineIndex - input.spineIndex) * 1.2;
    const score = epi + indexPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = { point: c.right, candidate: c, epipolarPx: epi };
    }
  }
  return best;
}
