// 大黄鱼鱼群仿真:骨骼摆尾、绕箱巡游、躲避相机
import { Vec3, v3, randNormal, clamp } from "../core/math"
import { Cage, CameraRig } from "../db/db"

export interface Fish {
  id: string
  cageId: string
  forkLen: number // m,真值
  pos: Vec3
  heading: number // rad
  speed: number // m/s
  phase: number // 摆尾相位
  amp: number // 摆尾幅度
  targetDepth: number
  tint: number // 体色个体差异
}

// 放苗天数 -> 平均叉长(cm),简化生长模型
export const meanForkLenCm = (stockDate: string): number => {
  const days = Math.max(0, (Date.now() - new Date(stockDate).getTime()) / 86400000)
  return clamp(6 + days * 0.09, 6, 42)
}

export const spawnSchool = (cage: Cage, count = 36): Fish[] => {
  const mean = meanForkLenCm(cage.stockDate)
  const R = cage.circumference / (2 * Math.PI)
  const fishes: Fish[] = []
  for (let i = 0; i < count; i++) {
    const len = Math.max(0.05, randNormal(mean, mean * 0.09) / 100)
    const ang = Math.random() * Math.PI * 2
    const r = (0.25 + Math.random() * 0.55) * R
    fishes.push({
      id: crypto.randomUUID(),
      cageId: cage.id,
      forkLen: len,
      pos: [Math.cos(ang) * r, -(0.8 + Math.random() * (cage.netDepth - 1.6)), Math.sin(ang) * r],
      heading: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      amp: 0.06 + Math.random() * 0.05,
      targetDepth: -(0.8 + Math.random() * (cage.netDepth - 1.6)),
      tint: Math.random(),
    })
  }
  return fishes
}

// 相机眼的世界坐标(左右眼)
export const cameraEyePositions = (cam: CameraRig, cage: Cage): { left: Vec3; right: Vec3; yaw: number } => {
  const R = cage.circumference / (2 * Math.PI)
  const px = Math.cos(cam.posAngle) * (R - 0.3)
  const pz = Math.sin(cam.posAngle) * (R - 0.3)
  // 朝向圆心 + 偏航
  const yaw = Math.atan2(-px, -pz) + cam.yawOffset
  const fx = Math.sin(yaw), fz = Math.cos(yaw)
  const rx = fz, rz = -fx // 右方向 = rotY(yaw) 的 x 列? 取 (cos? ) — 直接用旋转矩阵列
  void rx; void rz
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw)
  const rightDir: Vec3 = [cosY, 0, -sinY]
  const c: Vec3 = [px, -cam.installDepth, pz]
  return {
    left: v3.sub(c, v3.scale(rightDir, cam.baseline / 2)),
    right: v3.add(c, v3.scale(rightDir, cam.baseline / 2)),
    yaw,
  }
}

export const updateSchool = (
  fishes: Fish[], cage: Cage, cameras: CameraRig[], dt: number, time: number,
): void => {
  const R = cage.circumference / (2 * Math.PI)
  const camPts: Vec3[] = cameras.flatMap((c) => {
    const e = cameraEyePositions(c, cage)
    return [e.left, e.right]
  })
  for (const f of fishes) {
    const px = f.pos[0], pz = f.pos[2]
    const r = Math.hypot(px, pz) || 1e-6
    // 绕圈切向(逆时针)
    let dx = -pz / r, dz = px / r
    let dy = 0
    // 边界回推
    if (r > R - 0.6) { dx -= (px / r) * 0.9; dz -= (pz / r) * 0.9 }
    if (r < R * 0.15) { dx += (px / r) * 0.5; dz += (pz / r) * 0.5 }
    // 深度缓慢变化
    if (Math.random() < 0.002) f.targetDepth = -(0.8 + Math.random() * (cage.netDepth - 1.6))
    dy = clamp((f.targetDepth - f.pos[1]) * 0.4, -0.3, 0.3)
    // 躲相机
    for (const cp of camPts) {
      const d = v3.dist(f.pos, cp)
      if (d < 2.0) {
        const w = (2.0 - d) * 1.6
        dx += ((f.pos[0] - cp[0]) / (d || 1)) * w
        dy += ((f.pos[1] - cp[1]) / (d || 1)) * w * 0.5
        dz += ((f.pos[2] - cp[2]) / (d || 1)) * w
      }
    }
    // 个体游动噪声
    dx += Math.sin(time * 0.7 + f.phase * 3) * 0.15
    dz += Math.cos(time * 0.6 + f.phase * 2) * 0.15
    const targetHeading = Math.atan2(dx, dz)
    let dh = targetHeading - f.heading
    while (dh > Math.PI) dh -= 2 * Math.PI
    while (dh < -Math.PI) dh += 2 * Math.PI
    f.heading += clamp(dh, -1.8 * dt, 1.8 * dt)
    const sp = f.speed * (0.85 + 0.3 * Math.sin(time * 0.5 + f.phase))
    f.pos[0] += Math.sin(f.heading) * sp * dt
    f.pos[1] += dy * dt
    f.pos[2] += Math.cos(f.heading) * sp * dt
    f.pos[1] = clamp(f.pos[1], -(cage.netDepth - 0.4), -0.5)
    f.phase += dt * (5 + sp * 5)
  }
}

// 鱼体中轴关键点(世界系):吻端 t=0,尾叉 t=1,中间脊椎点
export const fishSpinePoint = (f: Fish, t: number, time: number): Vec3 => {
  const bend = f.amp * t * Math.sin(f.phase - t * 6.0)
  const c = Math.cos(f.heading), s = Math.sin(f.heading)
  const lx = t * f.forkLen
  const lz = bend * f.forkLen
  return [f.pos[0] + c * lx + s * lz, f.pos[1], f.pos[2] - s * lx + c * lz]
}
