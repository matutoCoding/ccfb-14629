import type { MeasurementRecord, Season, Settings } from '../types';
import { mean, std } from './math3d';
import { fmtInt } from './format';

export function seasonForDate(d = new Date()): Season {
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

export function weightFromLength(lengthMm: number, season: Season, settings: Settings): number {
  const cm = lengthMm / 10;
  const c = settings.lengthWeight[season];
  return c.a * Math.pow(cm, c.b);
}

export function adgFromRecords(records: MeasurementRecord[], windowDays = 21): {
  lengthMmPerDay: number;
  weightGPerDay: number;
  sampleDays: number;
} {
  if (records.length < 2) return { lengthMmPerDay: 0, weightGPerDay: 0, sampleDays: 0 };
  const sorted = [...records].sort((a, b) => +new Date(a.measuredAt) - +new Date(b.measuredAt));
  const latest = +new Date(sorted[sorted.length - 1].measuredAt);
  const recent = sorted.filter((r) => latest - +new Date(r.measuredAt) <= windowDays * 86400000);
  const use = recent.length >= 2 ? recent : sorted;
  const t0 = +new Date(use[0].measuredAt);
  const t1 = +new Date(use[use.length - 1].measuredAt);
  const days = Math.max(1, (t1 - t0) / 86400000);
  // Linear regression slope is more stable than endpoints.
  const xs = use.map((r) => (+new Date(r.measuredAt) - t0) / 86400000);
  const yL = use.map((r) => r.forkLengthMm);
  const yW = use.map((r) => r.weightG);
  const slope = (ys: number[]) => {
    const mx = mean(xs), my = mean(ys);
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    return den > 0 ? num / den : (ys[ys.length - 1] - ys[0]) / days;
  };
  return { lengthMmPerDay: slope(yL), weightGPerDay: slope(yW), sampleDays: days };
}

export function daysToMarket(records: MeasurementRecord[], settings: Settings): {
  daysWeight: number | null;
  daysLength: number | null;
  currentWeightG: number;
  currentLengthMm: number;
  adgG: number;
} {
  const cageRecords = records;
  const lengths = cageRecords.map((r) => r.forkLengthMm);
  const weights = cageRecords.map((r) => r.weightG);
  const currentLengthMm = mean(lengths);
  const currentWeightG = mean(weights);
  const { weightGPerDay, lengthMmPerDay } = adgFromRecords(cageRecords);
  const daysWeight = weightGPerDay > 0.5 && currentWeightG < settings.marketWeightG
    ? (settings.marketWeightG - currentWeightG) / weightGPerDay
    : currentWeightG >= settings.marketWeightG ? 0 : null;
  const daysLength = lengthMmPerDay > 0.05 && currentLengthMm < settings.marketLengthMm
    ? (settings.marketLengthMm - currentLengthMm) / lengthMmPerDay
    : currentLengthMm >= settings.marketLengthMm ? 0 : null;
  return { daysWeight, daysLength, currentWeightG, currentLengthMm, adgG: weightGPerDay };
}

export function feedRecommendation(input: {
  stockCount: number;
  survivalRate: number;
  avgWeightG: number;
  tempC: number;
  settings: Settings;
}): { biomassKg: number; ratePct: number; feedKgDay: number; formula: string } {
  const count = Math.round(input.stockCount * input.survivalRate);
  const biomassKg = (count * input.avgWeightG) / 1000;
  // Warm-water croaker feeding curve: reduced in cold and stressful hot water.
  let tempFactor = 1;
  if (input.tempC < 12) tempFactor = 0.28;
  else if (input.tempC < 16) tempFactor = 0.55;
  else if (input.tempC < 20) tempFactor = 0.82;
  else if (input.tempC <= 26) tempFactor = 1;
  else if (input.tempC <= 29) tempFactor = 0.78;
  else tempFactor = 0.45;
  const baseRate = (input.settings.feedRateMinPct + input.settings.feedRateMaxPct) / 2;
  const ratePct = baseRate * tempFactor;
  const feedKgDay = biomassKg * (ratePct / 100);
  return {
    biomassKg,
    ratePct,
    feedKgDay,
    formula: `${fmtInt(count)} 尾 × ${input.avgWeightG.toFixed(0)}g × ${ratePct.toFixed(2)}%`,
  };
}

export function histogram(values: number[], binCount = 12): { x0: number; x1: number; count: number }[] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const binW = span / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({ x0: min + i * binW, x1: min + (i + 1) * binW, count: 0 }));
  values.forEach((v) => {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / binW));
    bins[idx].count++;
  });
  return bins;
}

export function accuracySummary(records: MeasurementRecord[]) {
  const reconciled = records.filter((r) => Number.isFinite(r.errorPct));
  const errors = reconciled.map((r) => r.errorPct!);
  const abs = errors.map((e) => Math.abs(e));
  const bias = mean(errors);
  const mape = mean(abs);
  const rmse = Math.sqrt(mean(errors.map((e) => e * e)));
  const sd = std(errors);
  return { count: reconciled.length, bias, mape, rmse, sd, goodPct: abs.filter((e) => e <= 2).length / Math.max(1, abs.length) };
}
