import { useEffect, useMemo, useRef, useState } from 'react';
import type { Cage, CameraRig, Settings } from '../types';
import { FishWorld, meanLengthForCage } from '../sim/world';
import { makeStereoRig, type StereoRigModel } from '../lib/camera';
import type { CalibrationProfile } from '../types';

export function cageRadius(cage: Cage): number {
  return cage.perimeterM / (2 * Math.PI);
}

export function useFishWorld(cage: Cage | undefined, rigs: StereoRigModel[], fishCount = 46, paused = false): FishWorld | null {
  const mean = cage ? meanLengthForCage(cage) : 370;
  const world = useMemo(
    () => (cage ? new FishWorld(cage.id, cage.perimeterM, cage.netDepthM, fishCount, mean) : null),
    // Cage identity and dimensions are enough; changing cage recreates the cohort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cage?.id, cage?.perimeterM, cage?.netDepthM, fishCount, Math.round(mean)],
  );
  const rigsRef = useRef(rigs);
  rigsRef.current = rigs;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    if (!world) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) world.update(dt, rigsRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world]);
  return world;
}

export function useTrueRig(rig: CameraRig | undefined, cage: Cage | undefined): StereoRigModel | null {
  return useMemo(() => {
    if (!rig || !cage) return null;
    return makeStereoRig(rig, cageRadius(cage), {
      bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0 },
    });
  }, [rig, cage]);
}

export function useMeasureRig(
  rig: CameraRig | undefined,
  cage: Cage | undefined,
  calibration: CalibrationProfile | undefined | null,
  settings: Settings | null,
): StereoRigModel | null {
  return useMemo(() => {
    if (!rig || !cage || !settings) return null;
    const bias = rig.bias;
    if (calibration) {
      return makeStereoRig(rig, cageRadius(cage), {
        intrinsics: calibration.intrinsics,
        distortion: calibration.distortion,
        glass: calibration.glass,
        baselineM: (calibration.stereoBaselineMm ?? rig.baselineMm) / 1000,
        bias,
      });
    }
    return makeStereoRig(rig, cageRadius(cage), { bias });
  }, [rig, cage, calibration, settings]);
}
