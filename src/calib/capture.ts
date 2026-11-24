// 水下棋盘格拍摄仿真:随机板位姿,真值投影 + 检测噪声
import { SIM_TRUTH, IMG_W, IMG_H, project } from "../core/camera"
import { Vec3, v3, m3MulV, rodrigues, randNormal } from "../core/math"
import { CalibView } from "./zhang"
import { CameraRig, Cage } from "../db/db"
import { trueRigPoses } from "../measure/measure"

export const BOARD_COLS = 9
export const BOARD_ROWS = 6
export const BOARD_SQUARE = 0.04 // m

export const boardPoints = (): Vec3[] => {
  const pts: Vec3[] = []
  for (let j = 0; j < BOARD_ROWS; j++)
    for (let i = 0; i < BOARD_COLS; i++) pts.push([i * BOARD_SQUARE, j * BOARD_SQUARE, 0])
  return pts
}

// 拍一组:板在双目重叠视野内随机摆放,角点加 0.4px 检测噪声
export const captureView = (cam: CameraRig, cage: Cage): CalibView | null => {
  const poses = trueRigPoses(cam, cage)
  const board = boardPoints()
  for (let attempt = 0; attempt < 200; attempt++) {
    // 在左眼前方 1.2~3m 随机位置,偏移随距离放大以覆盖视野边缘
    const dist = 1.2 + Math.random() * 1.8
    const fwd: Vec3 = [poses.left.rot[2], poses.left.rot[5], poses.left.rot[8]]
    const right: Vec3 = [poses.left.rot[0], poses.left.rot[3], poses.left.rot[6]]
    const up: Vec3 = [0, 1, 0]
    let center = v3.add(poses.left.pos, v3.scale(fwd, dist))
    center = v3.add(center, v3.scale(right, (Math.random() - 0.5) * dist * 0.85))
    center = v3.add(center, v3.scale(up, (Math.random() - 0.5) * dist * 0.5))
    // 随机姿态:大致面向相机,±50° 扰动
    const rvec: Vec3 = [
      randNormal(0, 0.5),
      randNormal(0, 0.5) + Math.PI, // 板面朝相机
      randNormal(0, 0.5),
    ]
    const R = rodrigues(rvec)
    const toWorld = (p: Vec3): Vec3 => v3.add(m3MulV(R, p), center)
    const leftPx: [number, number][] = []
    const rightPx: [number, number][] = []
    let ok = true
    for (const p of board) {
      const pw = toWorld(p)
      const pl = project(pw, poses.left, SIM_TRUTH)
      const pr = project(pw, poses.right, SIM_TRUTH)
      const margin = 30
      if (!pl || !pr ||
        pl[0] < margin || pl[0] > IMG_W - margin || pl[1] < margin || pl[1] > IMG_H - margin ||
        pr[0] < margin || pr[0] > IMG_W - margin || pr[1] < margin || pr[1] > IMG_H - margin) {
        ok = false
        break
      }
      leftPx.push([pl[0] + randNormal(0, 0.4), pl[1] + randNormal(0, 0.4)])
      rightPx.push([pr[0] + randNormal(0, 0.4), pr[1] + randNormal(0, 0.4)])
    }
    if (ok) return { points3d: board, left: leftPx, right: rightPx }
  }
  return null
}
