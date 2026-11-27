import type { CameraRig, Cage, MeasurementRecord, Settings } from '../types';
import { idb } from './db';
import { uid } from './math3d';
import { seasonForDate, weightFromLength } from './growth';

export const DEFAULT_SETTINGS: Settings = {
  id: 'singleton',
  activeCageId: 'cage-01',
  activeRigId: 'rig-01a',
  season: seasonForDate(),
  waterTempC: 22.6,
  marketWeightG: 600,
  marketLengthMm: 340,
  lengthWeight: {
    spring: { a: 0.0182, b: 2.96, label: '春季 0.0182·L^2.96' },
    summer: { a: 0.0194, b: 2.95, label: '夏季 0.0194·L^2.95' },
    autumn: { a: 0.0203, b: 2.94, label: '秋季育肥 0.0203·L^2.94' },
    winter: { a: 0.0169, b: 2.97, label: '冬季 0.0169·L^2.97' },
  },
  feedRateMinPct: 1.2,
  feedRateMaxPct: 2.4,
  autoMeasureIntervalSec: 8,
  confidenceThreshold: 0.72,
  maxObliqueDeg: 28,
  calibrationNoisePx: 0.16,
  measurementNoisePx: 0.05,
  webgpuPreferred: true,
  reducedResolution: false,
};

function makeCages(): Cage[] {
  const species = ['大黄鱼', '大黄鱼', '大黄鱼', '大黄鱼', '真鲷暂养'];
  const cages: Cage[] = [];
  const base = new Date('2026-04-08T08:00:00').getTime();
  for (let i = 1; i <= 12; i++) {
    const d = new Date(base + (i % 5) * 6 * 86400000);
    cages.push({
      id: `cage-${String(i).padStart(2, '0')}`,
      code: `DHY-${String(i).padStart(2, '0')}`,
      name: `${i}号深水网箱`,
      perimeterM: 40 + (i % 4) * 6,
      netDepthM: 10 + (i % 3) * 2,
      stockingDate: d.toISOString().slice(0, 10),
      species: i === 11 ? species[4] : species[0],
      stockCount: 9000 + ((i * 1337) % 7000),
      survivalRate: 0.82 + ((i * 17) % 11) / 100,
      season: seasonForDate(),
      note: i <= 2 ? '样板箱，装两台双目相机，共四路画面' : '常规巡检箱',
      createdAt: d.toISOString(),
    });
  }
  return cages;
}

function makeRigs(cages: Cage[]): CameraRig[] {
  const rigs: CameraRig[] = [];
  cages.forEach((cage, ci) => {
    const count = ci < 2 ? 2 : ci % 3 === 0 ? 2 : 1;
    for (let j = 0; j < count; j++) {
      const letter = String.fromCharCode(97 + j);
      rigs.push({
        id: `rig-${String(ci + 1).padStart(2, '0')}${letter}`,
        cageId: cage.id,
        name: count === 2 ? `${j === 0 ? 'A组' : 'B组'}双目` : '主双目',
        installDepthM: 2.2 + j * 1.4 + (ci % 3) * 0.25,
        mountAzimuthDeg: j === 0 ? 18 + ci * 7 : 198 + ci * 5,
        yawDeg: j === 0 ? -4 : 5,
        pitchDeg: 8 + j * 5,
        rollDeg: 0,
        baselineMm: 620,
        focalLengthMm: 5.8,
        sensorWidthMm: 7.2,
        width: 960,
        height: 540,
        glass: {
          enabled: true,
          airGapM: 0.018,
          thicknessM: 0.008,
          iorGlass: 1.52,
          iorWater: 1.333,
        },
        trueDistortion: { k1: -0.118, k2: 0.026, p1: 0.0004, p2: -0.0003, k3: 0.006 },
        activeCalibrationId: null,
        principalPointXRatio: 0.5,
        principalPointYRatio: 0.5,
        bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0.05 },
        createdAt: cage.createdAt,
      });
    }
  });
  return rigs;
}

function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeHistory(cages: Cage[], settings: Settings): MeasurementRecord[] {
  const records: MeasurementRecord[] = [];
  const rand = seededRandom(20261127);
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  cages.slice(0, 8).forEach((cage, ci) => {
    const rigId = ci === 0 ? 'rig-01a' : `rig-${String(ci + 1).padStart(2, '0')}a`;
    const cageBase = 350 - ci * 7 + gauss() * 8;
    for (let day = 84; day >= 0; day -= 7) {
      const date = new Date('2026-11-27T09:00:00').getTime() - day * 86400000;
      const growth = (84 - day) * 0.52;
      const sampleN = ci === 0 ? 18 : 8;
      for (let k = 0; k < sampleN; k++) {
        const trueLength = cageBase - 42 + growth + gauss() * 24;
        // Correct calibration, subpixel matching: unbiased sub-percent scale noise.
        const errorPct = gauss() * 0.82 + (rand() - 0.5) * 0.25;
        const measured = trueLength * (1 + errorPct / 100);
        const season = seasonForDate(new Date(date));
        const localSettings = { ...settings, season };
        const weight = weightFromLength(measured, season, localSettings);
        const id = uid('m');
        records.push({
          id,
          measuredAt: new Date(date + k * 67000).toISOString(),
          cageId: cage.id,
          rigId,
          method: rand() > 0.22 ? 'auto' : 'manual',
          forkLengthMm: measured,
          weightG: weight,
          confidence: 0.76 + rand() * 0.22,
          season,
          waterTempC: 21 + Math.sin(day / 12) * 4 + gauss() * 0.4,
          segmentCount: 4 + Math.floor(rand() * 3),
          reprojErrorPx: 0.18 + rand() * 0.45,
          leftSnout: [0, 0],
          leftTail: [1, 0],
          rightSnout: [0, 0],
          rightTail: [1, 0],
          epipolarErrorPx: 0.2 + rand() * 0.8,
          obliqueDeg: 6 + rand() * 18,
          occlusionPct: rand() * 8,
          truthFishId: `hist-${ci}-${k}`,
          trueLengthMm: trueLength,
          errorMm: measured - trueLength,
          errorPct,
          lengthWeightA: settings.lengthWeight[season].a,
          lengthWeightB: settings.lengthWeight[season].b,
          calibrationId: null,
          biased: false,
        });
      }
    }
  });
  return records;
}

type SeedResult = { cages: Cage[]; rigs: CameraRig[]; settings: Settings; measurements: MeasurementRecord[] };

let seedPromise: Promise<SeedResult> | null = null;

export function seedIfNeeded(): Promise<SeedResult> {
  if (!seedPromise) seedPromise = seedIfNeededInner();
  return seedPromise;
}

async function seedIfNeededInner(): Promise<SeedResult> {
  let settings = await idb.get<Settings>('settings', 'singleton');
  if (settings) {
    const [cages, rigs, measurements] = await Promise.all([
      idb.getAll<Cage>('cages'),
      idb.getAll<CameraRig>('rigs'),
      idb.getAll<MeasurementRecord>('measurements'),
    ]);
    return { cages, rigs, settings, measurements };
  }
  settings = DEFAULT_SETTINGS;
  const cages = makeCages();
  const rigs = makeRigs(cages);
  const measurements = makeHistory(cages, settings);
  await idb.put('settings', settings);
  await idb.bulkPut('cages', cages);
  await idb.bulkPut('rigs', rigs);
  await idb.bulkPut('measurements', measurements);
  return { cages, rigs, settings, measurements };
}

export async function resetDemoData(): Promise<void> {
  await Promise.all(['cages', 'rigs', 'calibrations', 'measurements', 'settings'].map((s) => idb.clear(s)));
  seedPromise = null;
  await seedIfNeeded();
}
