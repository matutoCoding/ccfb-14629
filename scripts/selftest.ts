import { FishWorld } from '../src/sim/world';
import { makeStereoRig } from '../src/lib/camera';
import { measureCandidateAxis, evaluateFish } from '../src/sim/measure';
import { generateCalibrationCaptures, capturesToMonoInputs, calibrateMono } from '../src/lib/calibration';
import { DEFAULT_SETTINGS } from '../src/lib/seed';
import type { CameraRig } from '../src/types';

const rig: CameraRig = {
  id: 'rig-test', cageId: 'cage-01', name: 'test', installDepthM: 2.4, mountAzimuthDeg: 20,
  yawDeg: -3, pitchDeg: 10, rollDeg: 0, baselineMm: 620, focalLengthMm: 5.8, sensorWidthMm: 7.2,
  width: 960, height: 540,
  glass: { enabled: true, airGapM: 0.018, thicknessM: 0.008, iorGlass: 1.52, iorWater: 1.333 },
  trueDistortion: { k1: -0.118, k2: 0.026, p1: 0.0004, p2: -0.0003, k3: 0.006 },
  activeCalibrationId: null, principalPointXRatio: 0.5, principalPointYRatio: 0.5,
  bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0.22 }, createdAt: new Date().toISOString(),
};
const cage = { id: 'cage-01', perimeterM: 48, netDepthM: 12 } as any;
const radius = cage.perimeterM / (2 * Math.PI);
const trueRig = makeStereoRig(rig, radius, { bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0 } });

function run(label: string, measureRig = trueRig, noise = 0.05, steps = 14) {
  const world = new FishWorld('cage-01-selftest', cage.perimeterM, cage.netDepthM, 44, 372);
  const errors: number[] = [];
  const samples: { true: number; meas: number; errPct: number }[] = [];
  const settings = { ...DEFAULT_SETTINGS, measurementNoisePx: noise };
  for (let step = 0; step < steps; step++) {
    world.update(0.7, [trueRig]);
    const evaluations = world.fishes.map((fish) => evaluateFish(world, fish, trueRig, settings));
    evaluations.filter((e) => e.eligible).forEach((ev, i) => {
      const fish = ev.fish;
      const d = measureCandidateAxis({
        fish, renderRig: trueRig, measureRig, settings,
        nonce: 2000 + step * 131 + i * 17, rigId: rig.id, cageId: cage.id, method: 'auto', segmentCount: 10,
        evaluation: ev,
      });
      if (d && Number.isFinite(d.errorPct) && Math.abs(d.errorPct!) < 25) {
        errors.push(d.errorPct!);
        samples.push({ true: d.trueLengthMm!, meas: d.forkLengthMm, errPct: d.errorPct! });
      }
    });
  }
  const mean = errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length);
  const mape = errors.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, errors.length);
  const within2 = errors.filter((e) => Math.abs(e) <= 2).length / Math.max(1, errors.length);
  console.log(`\n[${label}] n=${errors.length} MAPE=${mape.toFixed(3)}% bias=${mean.toFixed(3)}% <=2%=${(within2 * 100).toFixed(1)}%`);
  console.log('worst', samples.sort((a, b) => Math.abs(b.errPct) - Math.abs(a.errPct)).slice(0, 5));
  return { mape, bias: mean, n: errors.length };
}

const exact = run('exact geometry + 0.05px noise');
const biased = run('baseline -3%', makeStereoRig(rig, radius, { bias: { baselinePct: -3, focalPct: 0, k1: 0, noisePx: 0 } }), 0.05);

console.log('\nGenerating calibration captures...');
const captures = generateCalibrationCaptures(trueRig, 9, 6, 60, 14, 0.16);
const included = captures.filter((c) => !c.badSample);
const left = await calibrateMono(capturesToMonoInputs(included, 'left'), trueRig.left.intrinsics, rig.glass, { maxIterations: 18 });
const right = await calibrateMono(capturesToMonoInputs(included, 'right'), trueRig.right.intrinsics, rig.glass, { maxIterations: 18, initialDistortion: left.distortion });
console.log('left calibration', { rms: left.rmsPx, fx: left.intrinsics.fx, cx: left.intrinsics.cx, k1: left.distortion.k1, k2: left.distortion.k2 });
console.log('right calibration', { rms: right.rmsPx, fx: right.intrinsics.fx, k1: right.distortion.k1 });
const calibratedRig = makeStereoRig(rig, radius, {
  intrinsics: left.intrinsics,
  distortion: left.distortion,
  glass: rig.glass,
  baselineM: rig.baselineMm / 1000,
  bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0 },
});
const calibrated = run('solved calibration', calibratedRig, 0.05, 14);

if (exact.mape > 2) { console.error('FAIL exact MAPE > 2'); process.exit(1); }
if (calibrated.mape > 2.2) { console.error('FAIL calibrated MAPE > 2.2'); process.exit(1); }
if (Math.abs(biased.bias + 3) > 0.8) { console.error('FAIL bias did not reflect -3% baseline'); process.exit(1); }
console.log('\nSELFTEST OK');
