// 测量链路:有效参数合成、NCC 极线匹配、三角测量、自动测量
import {
  CamParams, CamPose, IMG_W, IMG_H, SIM_TRUTH,
  project, pixelToRay, triangulate, triangulateFull, epipolarLine, rightPoseFrom, makePose,
} from "../core/camera"
import { Vec3, v3, randNormal, clamp } from "../core/math"
import { CameraRig, Cage, Settings, Measurement, Calibration, uid } from "../db/db"
import { Fish, fishSpinePoint, cameraEyePositions } from "../sim/fish"

// 合成测量用参数:相机使用值 + 设置里的扰动
export const effectiveParams = (cam: CameraRig, settings: Settings): CamParams => {
  const p = settings.perturb
  return {
    ...cam.used,
    fx: cam.used.fx * (1 + p.fxPct / 100),
    fy: cam.used.fy * (1 + p.fxPct / 100),
    portDist: cam.used.portDist + p.portDist,
    nWater: cam.used.nWater + p.nWater,
    k1: cam.used.k1 + p.k1,
  }
}

export const effectiveBaseline = (cam: CameraRig, settings: Settings): number =>
  cam.baseline * (1 + settings.perturb.baselinePct / 100)

// 测量用左右眼位姿(左眼=安装位,右眼由标定相对位姿或标称基线合成)
export const usedRigPoses = (
  cam: CameraRig, cage: Cage, settings: Settings, calib: Calibration | null,
): { left: CamPose; right: CamPose } => {
  const eye = cameraEyePositions(cam, cage)
  const left = makePose(eye.left, eye.yaw)
  if (calib) {
    // 标定相对位姿 + 基线扰动
    const relT = v3.scale(calib.result.relT, 1 + settings.perturb.baselinePct / 100)
    return { left, right: rightPoseFrom(left, calib.result.relR, relT) }
  }
  const b = effectiveBaseline(cam, settings)
  const rightDir: Vec3 = [Math.cos(eye.yaw), 0, -Math.sin(eye.yaw)]
  return { left, right: makePose(v3.add(eye.left, v3.scale(rightDir, b)), eye.yaw) }
}

// 渲染真值位姿(右眼严格按真实基线)
export const trueRigPoses = (cam: CameraRig, cage: Cage): { left: CamPose; right: CamPose } => {
  const eye = cameraEyePositions(cam, cage)
  const rightDir: Vec3 = [Math.cos(eye.yaw), 0, -Math.sin(eye.yaw)]
  return {
    left: makePose(eye.left, eye.yaw),
    right: makePose(v3.add(eye.left, v3.scale(rightDir, 0.12)), eye.yaw),
  }
}

// 单点三角测量
export const triangulatePoint = (
  uL: number, vL: number, uR: number, vR: number,
  poseL: CamPose, paramsL: CamParams, poseR: CamPose, paramsR: CamParams,
): Vec3 => triangulate(pixelToRay(uL, vL, poseL, paramsL), pixelToRay(uR, vR, poseR, paramsR))

// 体长测量:平均深度 × 左图张角(含各像素射线原点偏移)
// 鱼体近似正面平行,独立三角化两端会把深度噪声放大进体长;
// 深度取两点均值,两点沿各自射线放到平均深度上再求距
export const stereoLength = (
  u1L: number, v1L: number, u1R: number, v1R: number,
  u2L: number, v2L: number, u2R: number, v2R: number,
  poseL: CamPose, paramsL: CamParams, poseR: CamPose, paramsR: CamParams,
): number => {
  const ray1L = pixelToRay(u1L, v1L, poseL, paramsL)
  const ray2L = pixelToRay(u2L, v2L, poseL, paramsL)
  const t1 = triangulateFull(ray1L, pixelToRay(u1R, v1R, poseR, paramsR))
  const t2 = triangulateFull(ray2L, pixelToRay(u2R, v2R, poseR, paramsR))
  const zMean = (t1.s1 + t2.s1) / 2
  const p1 = v3.add(ray1L.origin, v3.scale(ray1L.dir, zMean))
  const p2 = v3.add(ray2L.origin, v3.scale(ray2L.dir, zMean))
  return v3.dist(p1, p2)
}

// 分段中轴测量:相邻点逐段 stereoLength 求和(m)
export const measureSegmented = (
  left: [number, number][], right: [number, number][],
  poseL: CamPose, paramsL: CamParams, poseR: CamPose, paramsR: CamParams,
): number => {
  let len = 0
  for (let i = 1; i < left.length; i++) {
    len += stereoLength(
      left[i - 1][0], left[i - 1][1], right[i - 1][0], right[i - 1][1],
      left[i][0], left[i][1], right[i][0], right[i][1],
      poseL, paramsL, poseR, paramsR,
    )
  }
  return len
}

// NCC 模板匹配:沿右图极线找左图点的对应点(传感器坐标)
export const nccMatch = (
  imgL: Uint8Array, imgR: Uint8Array, vw: number, vh: number,
  uL: number, vL: number, line: [number, number, number],
): { u: number; v: number; score: number } => {
  const s = vw / IMG_W // 显示分辨率 / 传感器分辨率
  const gray = (img: Uint8Array, x: number, y: number): number => {
    const xi = clamp(Math.round(x), 0, vw - 1)
    const yi = clamp(Math.round(y), 0, vh - 1)
    const o = (yi * vw + xi) * 4
    return (img[o] * 2 + img[o + 1] * 3 + img[o + 2]) / 6
  }
  const R = 4 // 模板半径(显示像素)
  const tpl: number[] = []
  let tplMean = 0
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const g = gray(imgL, uL * s + dx, vL * s + dy)
      tpl.push(g)
      tplMean += g
    }
  tplMean /= tpl.length
  let tplVar = 0
  for (const g of tpl) tplVar += (g - tplMean) * (g - tplMean)
  if (tplVar < 1) return { u: 0, v: 0, score: 0 }
  // 极线方向(传感器系)
  const [a, b, c] = line
  const dir: [number, number] = [-b, a]
  const n = Math.hypot(dir[0], dir[1]) || 1
  dir[0] /= n; dir[1] /= n
  // 起猜点:与左点同 v 处极线上的点
  const t0 = Math.abs(b) > 1e-6 ? (uL * -a - c) / b : vL
  let best = { u: 0, v: 0, score: -1 }
  for (let u = 8; u < IMG_W - 8; u += 1) {
    const v = Math.abs(b) > 1e-6 ? (-a * u - c) / b : t0
    if (v < 8 || v >= IMG_H - 8) continue
    let mean = 0
    const vals: number[] = []
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const g = gray(imgR, u * s + dx, v * s + dy)
        vals.push(g)
        mean += g
      }
    mean /= vals.length
    let num = 0, den = 0
    for (let i = 0; i < vals.length; i++) {
      num += (vals[i] - mean) * (tpl[i] - tplMean)
      den += (vals[i] - mean) * (vals[i] - mean)
    }
    const score = num / Math.sqrt(den * tplVar + 1e-9)
    if (score > best.score) best = { u, v, score }
  }
  return best
}

// 自动测量一轮:挑侧身、完整入画、无遮挡的鱼
export const autoMeasure = (
  fishes: Fish[], cam: CameraRig, cage: Cage, settings: Settings,
  calib: Calibration | null, time: number,
): { measured: Measurement[]; skipped: number } => {
  const used = effectiveParams(cam, settings)
  const usedPoses = usedRigPoses(cam, cage, settings, calib)
  const truePoses = trueRigPoses(cam, cage)
  const measured: Measurement[] = []
  let skipped = 0
  for (const f of fishes) {
    const snout = fishSpinePoint(f, 0, time)
    const fork = fishSpinePoint(f, 1, time)
    const bodyDir = v3.norm(v3.sub(fork, snout))
    const viewDir: Vec3 = [usedPoses.left.rot[2], usedPoses.left.rot[5], usedPoses.left.rot[8]]
    const sideOn = Math.abs(v3.dot(bodyDir, viewDir))
    if (sideOn > 0.45) { skipped++; continue }
    // 真值投影(观测),两眼都要完整入画
    const obs: [number, number][] = []
    let ok = true
    for (const pose of [truePoses.left, truePoses.right]) {
      for (const pt of [snout, fork]) {
        const px = project(pt, pose, SIM_TRUTH)
        if (!px || px[0] < 60 || px[0] > IMG_W - 60 || px[1] < 60 || px[1] > IMG_H - 60) { ok = false; break }
        obs.push(px)
      }
      if (!ok) break
    }
    if (!ok) { skipped++; continue }
    // 遮挡:其他鱼投影离中点太近且更近
    const midL: [number, number] = [(obs[0][0] + obs[1][0]) / 2, (obs[0][1] + obs[1][1]) / 2]
    const mid3 = v3.scale(v3.add(snout, fork), 0.5)
    let occluded = false
    for (const g of fishes) {
      if (g === f) continue
      const gm = fishSpinePoint(g, 0.5, time)
      const gp = project(gm, truePoses.left, SIM_TRUTH)
      if (!gp) continue
      if (Math.hypot(gp[0] - midL[0], gp[1] - midL[1]) < 45) {
        const dF = v3.dist(mid3, truePoses.left.pos)
        const dG = v3.dist(gm, truePoses.left.pos)
        if (dG < dF - 0.25) { occluded = true; break }
      }
    }
    if (occluded) { skipped++; continue }
    const dist = v3.dist(mid3, truePoses.left.pos)
    if (dist < 1.0 || dist > 4.0) { skipped++; continue }
    // 观测加噪(亚像素检测噪声),用测量参数按平均深度×张角求叉长
    const noisy = obs.map((p) => [p[0] + randNormal(0, 0.6), p[1] + randNormal(0, 0.6)] as [number, number])
    const lenM = stereoLength(
      noisy[0][0], noisy[0][1], noisy[2][0], noisy[2][1],
      noisy[1][0], noisy[1][1], noisy[3][0], noisy[3][1],
      usedPoses.left, used, usedPoses.right, used,
    )
    const confidence = clamp(
      (1 - sideOn / 0.45) * 0.5 + clamp((6 - dist) / 5, 0, 1) * 0.3 + 0.2, 0, 1,
    )
    const a = settings.lwA[settings.season]
    const b = settings.lwB[settings.season]
    const lenCm = lenM * 100
    measured.push({
      id: uid(), cageId: cage.id, cameraId: cam.id, date: Date.now(),
      type: "auto", forkLength: lenCm, weight: a * Math.pow(lenCm, b),
      confidence, fishId: f.id, trueLength: f.forkLen * 100, createdAt: Date.now(),
    })
  }
  return { measured, skipped }
}

export { epipolarLine }
