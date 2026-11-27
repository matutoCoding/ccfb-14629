export type ID = string;

export interface Cage {
  id: ID;
  code: string;
  name: string;
  perimeterM: number;
  netDepthM: number;
  stockingDate: string; // YYYY-MM-DD
  species: string;
  stockCount: number;
  survivalRate: number; // 0-1
  season: Season;
  note?: string;
  createdAt: string;
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface GlassParams {
  enabled: boolean;
  /** 相机光心到玻璃内表面，m */
  airGapM: number;
  thicknessM: number;
  iorGlass: number;
  iorWater: number;
}

export interface DistortionCoeffs {
  k1: number;
  k2: number;
  p1: number;
  p2: number;
  k3: number;
}

export interface BiasParams {
  baselinePct: number;
  focalPct: number;
  k1: number;
  noisePx: number;
}

export interface CameraRig {
  id: ID;
  cageId: ID;
  name: string;
  /** 安装深度，m */
  installDepthM: number;
  /** 网箱圆周安装方位，度 */
  mountAzimuthDeg: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  baselineMm: number;
  focalLengthMm: number;
  sensorWidthMm: number;
  width: number;
  height: number;
  glass: GlassParams;
  /** 仿真真值畸变；渲染和棋盘格投影使用 */
  trueDistortion: DistortionCoeffs;
  activeCalibrationId?: ID | null;
  /** 未选择标定时使用的标称内参主点比例，默认画面中心 */
  principalPointXRatio: number;
  principalPointYRatio: number;
  bias: BiasParams;
  createdAt: string;
}

export interface Intrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export interface CalibrationImageStat {
  id: ID;
  index: number;
  capturedAt: string;
  poseLabel: string;
  cornerCount: number;
  rmsPx: number;
  maxErrorPx: number;
  included: boolean;
  badSample?: boolean;
  /** 6DoF：rodrigues + translation(m) */
  rvec: [number, number, number];
  tvec: [number, number, number];
  errors?: number[];
}

export interface CalibrationProfile {
  id: ID;
  rigId: ID;
  cageId: ID;
  createdAt: string;
  boardCols: number;
  boardRows: number;
  squareMm: number;
  imageCount: number;
  usedImageCount: number;
  intrinsics: Intrinsics;
  distortion: DistortionCoeffs;
  stereoR?: number[]; // 3x3, right-from-left
  stereoT?: [number, number, number]; // m
  stereoBaselineMm?: number;
  rmsPx: number;
  maxRmsPx: number;
  images: CalibrationImageStat[];
  glass: GlassParams;
  solverIterations: number;
  note?: string;
}

export type MeasurementMethod = 'manual' | 'auto';

export interface Segment3D {
  a: [number, number, number];
  b: [number, number, number];
  lengthMm: number;
  leftA?: [number, number];
  leftB?: [number, number];
  rightA?: [number, number];
  rightB?: [number, number];
}

export interface MeasurementRecord {
  id: ID;
  measuredAt: string;
  cageId: ID;
  rigId: ID;
  method: MeasurementMethod;
  /** 叉长/中轴累计长度，mm */
  forkLengthMm: number;
  weightG: number;
  confidence: number;
  season: Season;
  waterTempC: number;
  segmentCount: number;
  reprojErrorPx: number;
  leftSnout: [number, number];
  leftTail: [number, number];
  rightSnout: [number, number];
  rightTail: [number, number];
  epipolarErrorPx: number;
  obliqueDeg: number;
  occlusionPct: number;
  truthFishId?: ID;
  trueLengthMm?: number;
  errorMm?: number;
  errorPct?: number;
  lengthWeightA: number;
  lengthWeightB: number;
  calibrationId?: ID | null;
  biased?: boolean;
  segments?: Segment3D[];
}

export interface LengthWeightCoefficients {
  a: number;
  b: number;
  label: string;
}

export interface Settings {
  id: 'singleton';
  activeCageId: ID;
  activeRigId: ID;
  season: Season;
  waterTempC: number;
  marketWeightG: number;
  marketLengthMm: number;
  lengthWeight: Record<Season, LengthWeightCoefficients>;
  feedRateMinPct: number;
  feedRateMaxPct: number;
  autoMeasureIntervalSec: number;
  confidenceThreshold: number;
  maxObliqueDeg: number;
  calibrationNoisePx: number;
  measurementNoisePx: number;
  webgpuPreferred: boolean;
  reducedResolution: boolean;
}

export interface DbSchema {
  cages: Cage;
  rigs: CameraRig;
  calibrations: CalibrationProfile;
  measurements: MeasurementRecord;
  settings: Settings;
}
