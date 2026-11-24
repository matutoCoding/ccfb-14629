// 相机模型:针孔 + 径向畸变 + 防水壳平面玻璃折射
import { Vec3, Mat3, v3, m3MulV, m3Mul, m3T, rotY } from "./math"

export interface CamParams {
  fx: number; fy: number; cx: number; cy: number
  k1: number; k2: number
  portDist: number // 玻璃罩到光心距离 m
  nWater: number // 水折射率
}

export interface CamPose {
  pos: Vec3
  rot: Mat3 // 相机系 -> 世界系
}

export const IMG_W = 1280
export const IMG_H = 720

// 仿真真值(同一型号设备,渲染用)
export const SIM_TRUTH: CamParams = {
  fx: 1208.4, fy: 1211.2, cx: 638.2, cy: 361.7,
  k1: -0.085, k2: 0.012, portDist: 0.06, nWater: 1.333,
}

// 厂家标称值(未标定时测量用)
export const NOMINAL: CamParams = {
  fx: 1200, fy: 1200, cx: 640, cy: 360,
  k1: 0, k2: 0, portDist: 0.05, nWater: 1.333,
}

export const makePose = (pos: Vec3, yaw: number): CamPose => ({ pos, rot: rotY(yaw) })

// 世界 -> 相机系
export const worldToCam = (p: Vec3, pose: CamPose): Vec3 => m3MulV(m3T(pose.rot), v3.sub(p, pose.pos))

// 相机系 -> 世界
export const camToWorld = (p: Vec3, pose: CamPose): Vec3 => v3.add(m3MulV(pose.rot, p), pose.pos)

// 平面玻璃折射(前向):水中点 P -> 玻璃面折射点 Q 处的出射方向
// 解 Snell 方程求玻璃面上的折射点,返回以 Q 为方向的等效针孔点 (qx, qy, d)
export const refractPoint = (p: Vec3, params: CamParams): Vec3 => {
  const d = params.portDist
  if (p[2] <= 0) return p
  const n2 = params.nWater
  const rho = Math.hypot(p[0], p[1])
  if (rho < 1e-9) return p
  const ux = p[0] / rho, uy = p[1] / rho
  if (d < 1e-6) {
    // 界面在光心:纯角度映射 θ1 = asin(n2·sinθ2)
    const sinT2 = rho / Math.hypot(rho, p[2])
    const s1 = n2 * sinT2
    if (s1 >= 1) return [0, 0, -1] // 全反射,不可见
    const tanT1 = s1 / Math.sqrt(1 - s1 * s1)
    return [tanT1 * ux, tanT1 * uy, 1]
  }
  if (p[2] <= d) return p // 点在玻璃内侧(壳内空气),无折射
  // 求 q ∈ [0, rho]:n2·sinθ2(q) = sinθ1(q),二分求解
  let lo = 0, hi = rho
  for (let i = 0; i < 40; i++) {
    const q = (lo + hi) / 2
    const s1 = q / Math.hypot(q, d)
    const s2 = (rho - q) / Math.hypot(rho - q, p[2] - d)
    if (n2 * s2 > s1) lo = q
    else hi = q
  }
  const q = (lo + hi) / 2
  return [q * ux, q * uy, d]
}

// 畸变前向:归一化平面
export const distort = (x: number, y: number, p: CamParams): [number, number] => {
  const r2 = x * x + y * y
  const s = 1 + p.k1 * r2 + p.k2 * r2 * r2
  return [x * s, y * s]
}

// 迭代去畸变
export const undistort = (xd: number, yd: number, p: CamParams): [number, number] => {
  let x = xd, y = yd
  for (let i = 0; i < 8; i++) {
    const r2 = x * x + y * y
    const s = 1 + p.k1 * r2 + p.k2 * r2 * r2
    x = xd / s
    y = yd / s
  }
  return [x, y]
}

// 完整投影:世界点 -> 像素(含折射与畸变),点在光心后返回 null
export const project = (pw: Vec3, pose: CamPose, params: CamParams): [number, number] | null => {
  const pc = worldToCam(pw, pose)
  if (pc[2] <= 0.01) return null
  const pr = refractPoint(pc, params)
  const x = pr[0] / pr[2], y = pr[1] / pr[2]
  const [xd, yd] = distort(x, y, params)
  return [params.fx * xd + params.cx, params.fy * yd + params.cy]
}

export interface Ray { origin: Vec3; dir: Vec3 }

// 像素 -> 水中射线(世界系),在玻璃面处按 Snell 定律折入水中
export const pixelToRay = (u: number, v: number, pose: CamPose, params: CamParams): Ray => {
  const [x, y] = undistort((u - params.cx) / params.fx, (v - params.cy) / params.fy, params)
  const dirAir = v3.norm([x, y, 1])
  const d = params.portDist
  // 与玻璃面交点(相机系)
  const t = d / dirAir[2]
  const q: Vec3 = [dirAir[0] * t, dirAir[1] * t, dirAir[2] * t]
  // 向量折射:空气 n1=1 -> 水 n2,入射 I,法线 N=(0,0,-1)
  const eta = 1 / params.nWater
  const cosI = dirAir[2]
  const k = 1 - eta * eta * (1 - cosI * cosI)
  // T = (eta*Ix, eta*Iy, sqrt(k))(由 GLSL refract 化简)
  const dirWater: Vec3 = [eta * dirAir[0], eta * dirAir[1], Math.sqrt(Math.max(k, 1e-12))]
  return { origin: camToWorld(q, pose), dir: v3.norm(m3MulV(pose.rot, dirWater)) }
}

// 双目三角测量:两射线最近点中点,附带射线参数(沿射线距离)
export const triangulateFull = (r1: Ray, r2: Ray): { point: Vec3; s1: number; s2: number } => {
  const w0 = v3.sub(r1.origin, r2.origin)
  const a = v3.dot(r1.dir, r1.dir)
  const b = v3.dot(r1.dir, r2.dir)
  const c = v3.dot(r2.dir, r2.dir)
  const d = v3.dot(r1.dir, w0)
  const e = v3.dot(r2.dir, w0)
  const den = a * c - b * b
  const s = den > 1e-12 ? (b * e - c * d) / den : 0
  const t = den > 1e-12 ? (a * e - b * d) / den : 0
  const p1 = v3.add(r1.origin, v3.scale(r1.dir, s))
  const p2 = v3.add(r2.origin, v3.scale(r2.dir, t))
  return { point: v3.scale(v3.add(p1, p2), 0.5), s1: s, s2: t }
}

export const triangulate = (r1: Ray, r2: Ray): Vec3 => triangulateFull(r1, r2).point

// 左图像素 -> 右图极线(ax+by+c=0,像素系)
export const epipolarLine = (
  u: number, v: number,
  poseL: CamPose, paramsL: CamParams,
  poseR: CamPose, paramsR: CamParams,
): [number, number, number] => {
  // 左像素反投影成水中射线,取射线上两个深度点投到右图
  const ray = pixelToRay(u, v, poseL, paramsL)
  const p1 = v3.add(ray.origin, v3.scale(ray.dir, 0.5))
  const p2 = v3.add(ray.origin, v3.scale(ray.dir, 8))
  const q1 = project(p1, poseR, paramsR)
  const q2 = project(p2, poseR, paramsR)
  if (!q1 || !q2) return [0, 0, 1]
  const a = q1[1] - q2[1]
  const b = q2[0] - q1[0]
  const c = q1[0] * q2[1] - q2[0] * q1[1]
  const n = Math.hypot(a, b) || 1
  return [a / n, b / n, c / n]
}

// 由标定得到的双目相对位姿(p_right = relR*p_left + relT),合成右相机世界位姿
export const rightPoseFrom = (poseL: CamPose, relR: Mat3, relT: Vec3): CamPose => {
  const rotR = m3Mul(poseL.rot, m3T(relR))
  const posR = v3.sub(poseL.pos, m3MulV(rotR, relT))
  return { pos: posR, rot: rotR }
}
