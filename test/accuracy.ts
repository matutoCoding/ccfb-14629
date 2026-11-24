// 精度验证:标定解算 + 端到端测量误差(仿真真值对账)
import { SIM_TRUTH, NOMINAL, IMG_W, IMG_H, project } from "../src/core/camera"
import { Vec3, v3, randNormal } from "../src/core/math"
import { captureView } from "../src/calib/capture"
import { calibrateStereo } from "../src/calib/zhang"
import { effectiveParams, usedRigPoses, trueRigPoses, stereoLength } from "../src/measure/measure"
import { Cage, CameraRig, Calibration, Settings, DEFAULT_SETTINGS } from "../src/db/db"

const cage: Cage = {
  id: "c1", name: "测试箱", circumference: 40, netDepth: 6, stockDate: "2026-03-15",
  species: "大黄鱼", fishCount: 4000, createdAt: 0, updatedAt: 0,
}
const cam: CameraRig = {
  id: "m1", cageId: "c1", name: "相机1", baseline: 0.12, installDepth: 3,
  posAngle: 0, yawOffset: 0, used: { ...NOMINAL }, calibrated: false, createdAt: 0, updatedAt: 0,
}
const settings: Settings = structuredClone(DEFAULT_SETTINGS)

// 1) 标定:12 组棋盘格
const views = []
for (let i = 0; i < 12; i++) {
  const v = captureView(cam, cage)
  if (v) views.push(v)
}
console.log(`采集 ${views.length} 组`)
const result = calibrateStereo(views, IMG_W, IMG_H, NOMINAL.portDist)
console.log(`解算: fx=${result.left.fx.toFixed(1)} fy=${result.left.fy.toFixed(1)} cx=${result.left.cx.toFixed(1)} cy=${result.left.cy.toFixed(1)}`)
console.log(`      k1=${result.left.k1.toFixed(4)} k2=${result.left.k2.toFixed(4)} 基线=${result.baseline.toFixed(4)}m(真值 0.12)`)
console.log(`      平均重投影误差 左=${result.left.meanError.toFixed(3)}px 右=${result.right.meanError.toFixed(3)}px`)
console.log(`      右视图误差: ${result.right.views.map((v) => v.error.toFixed(2)).join(" ")}`)

// 标定结果写入(模拟保存标定)
cam.used = { fx: result.left.fx, fy: result.left.fy, cx: result.left.cx, cy: result.left.cy, k1: result.left.k1, k2: result.left.k2, portDist: result.left.portDist, nWater: 1.333 }
cam.baseline = result.baseline
const calib: Calibration = {
  id: "k1", cameraId: "m1", date: 0,
  result: { fx: result.left.fx, fy: result.left.fy, cx: result.left.cx, cy: result.left.cy, k1: result.left.k1, k2: result.left.k2, portDist: result.left.portDist, relR: result.relR, relT: result.relT, baseline: result.baseline },
  viewErrors: [], meanError: result.left.meanError,
}

// 2) 端到端测量:随机侧身的鱼,真值投影 + 1.2px 噪声,用测量参数三角化
const measureOnce = (useCalib: boolean): number[] => {
  const camCopy: CameraRig = useCalib ? cam : { ...cam, used: { ...NOMINAL }, baseline: 0.12 }
  const used = effectiveParams(camCopy, settings)
  const poses = usedRigPoses(camCopy, cage, settings, useCalib ? calib : null)
  const truePoses = trueRigPoses(camCopy, cage)
  const errors: number[] = []
  for (let i = 0; i < 300; i++) {
    // 随机一条侧身鱼:在左眼前方 1.5~5m,体轴垂直于视线
    const dist = 1.5 + Math.random() * 3.5
    const fwd: Vec3 = [truePoses.left.rot[2], truePoses.left.rot[5], truePoses.left.rot[8]]
    const right: Vec3 = [truePoses.left.rot[0], truePoses.left.rot[3], truePoses.left.rot[6]]
    const center = v3.add(truePoses.left.pos, v3.add(v3.scale(fwd, dist), v3.scale(right, (Math.random() - 0.5) * 1.5)))
    const len = 0.2 + Math.random() * 0.2 // 20~40cm
    const snout = v3.add(center, v3.scale(right, -len / 2))
    const fork = v3.add(center, v3.scale(right, len / 2))
    const pl = [snout, fork].map((p) => project(p, truePoses.left, SIM_TRUTH))
    const pr = [snout, fork].map((p) => project(p, truePoses.right, SIM_TRUTH))
    // 与自动测量一致:两眼都要完整入画(60px 边距)
    const inFrame = (p: [number, number] | null) =>
      p !== null && p[0] > 60 && p[0] < IMG_W - 60 && p[1] > 60 && p[1] < IMG_H - 60
    if (![...pl, ...pr].every(inFrame)) continue
    const noisy = [...pl, ...pr].map((p) => [p![0] + randNormal(0, 0.6), p![1] + randNormal(0, 0.6)])
    const measured = stereoLength(
      noisy[0][0], noisy[0][1], noisy[2][0], noisy[2][1],
      noisy[1][0], noisy[1][1], noisy[3][0], noisy[3][1],
      poses.left, used, poses.right, used,
    )
    errors.push(Math.abs(measured - len) / len * 100)
  }
  return errors
}

const report = (name: string, errors: number[]) => {
  const mean = errors.reduce((s, e) => s + e, 0) / errors.length
  const p95 = errors.sort((a, b) => a - b)[Math.floor(errors.length * 0.95)]
  console.log(`${name}: 平均误差 ${mean.toFixed(2)}%,P95 ${p95.toFixed(2)}%(n=${errors.length})`)
}

report("标定后测量", measureOnce(true))
report("未标定(标称参数)", measureOnce(false))

// 3) 扰动敏感性:焦距 +5%
settings.perturb.fxPct = 5
report("标定后+焦距偏5%", measureOnce(true))
settings.perturb.fxPct = 0
settings.perturb.baselinePct = 5
report("标定后+基线偏5%", measureOnce(true))
