// 张正友标定:单目内参+畸变+玻璃罩折射,双目相对位姿
import { Vec3, Mat3, v3, m3Mul, m3T, rodrigues, matToRvec, nullVector, lmSolve } from "../core/math"
import { refractPoint } from "../core/camera"

const N_WATER = 1.333

export interface CalibView {
  points3d: Vec3[] // 棋盘格世界坐标(z=0 平面)
  left: [number, number][]
  right: [number, number][]
}

export interface SingleResult {
  fx: number; fy: number; cx: number; cy: number; k1: number; k2: number
  portDist: number
  views: { rvec: Vec3; t: Vec3; error: number }[]
  meanError: number
}

export interface StereoResult {
  left: SingleResult
  right: SingleResult
  relR: Mat3
  relT: Vec3 // p_right = relR * p_left + relT
  baseline: number
}

// 单应 DLT(带 Hartley 归一化)
const homography = (pts3: Vec3[], pts2: [number, number][]): number[] => {  const n = pts3.length
  const norm2 = (pts: [number, number][]) => {
    const mx = pts.reduce((s, p) => s + p[0], 0) / n
    const my = pts.reduce((s, p) => s + p[1], 0) / n
    const md = pts.reduce((s, p) => s + Math.hypot(p[0] - mx, p[1] - my), 0) / n
    const s = Math.SQRT2 / (md || 1)
    return { mx, my, s }
  }
  const a = norm2(pts2)
  const mx3 = pts3.reduce((s, p) => s + p[0], 0) / n
  const my3 = pts3.reduce((s, p) => s + p[1], 0) / n
  const md3 = pts3.reduce((s, p) => s + Math.hypot(p[0] - mx3, p[1] - my3), 0) / n
  const s3 = Math.SQRT2 / (md3 || 1)
  const A: number[][] = []
  for (let i = 0; i < n; i++) {
    const X = (pts3[i][0] - mx3) * s3, Y = (pts3[i][1] - my3) * s3
    const u = (pts2[i][0] - a.mx) * a.s, v = (pts2[i][1] - a.my) * a.s
    A.push([-X, -Y, -1, 0, 0, 0, u * X, u * Y, u])
    A.push([0, 0, 0, -X, -Y, -1, v * X, v * Y, v])
  }
  const h = nullVector(A)
  // 反归一化:H = T2^-1 * Hn * T3
  const T2inv = [1 / a.s, 0, a.mx, 0, 1 / a.s, a.my, 0, 0, 1]
  const T3 = [s3, 0, -s3 * mx3, 0, s3, -s3 * my3, 0, 0, 1]
  return m3Mul(T2inv, m3Mul(h, T3))
}

// 由单应列向量构造 V 矩阵行
const vRow = (H: number[], i: number, j: number): number[] => {
  const h = (r: number, c: number) => H[r * 3 + c]
  const a = (r: number) => h(r, i), b = (r: number) => h(r, j)
  return [
    a(0) * b(0),
    a(0) * b(1) + a(1) * b(0),
    a(1) * b(1),
    a(0) * b(2) + a(2) * b(0),
    a(1) * b(2) + a(2) * b(1),
    a(2) * b(2),
  ]
}

interface Extrinsic { rvec: Vec3; t: Vec3 }

// 单目标定:先闭式解,再 LM 精化(含 k1,k2 与玻璃折射;portDist 为机械参数,固定取规格值)
export const calibrateSingle = (
  views: { points3d: Vec3[]; points2d: [number, number][] }[],
  imgW: number, imgH: number,
  portDist = 0.05,
): SingleResult => {
  const Hs = views.map((vw) => homography(vw.points3d, vw.points2d))
  const V: number[][] = []
  for (const H of Hs) {
    V.push(vRow(H, 0, 1))
    const v00 = vRow(H, 0, 0), v11 = vRow(H, 1, 1)
    V.push(v00.map((x, i) => x - v11[i]))
  }
  const b = nullVector(V)
  const [B11, B12, B22, B13, B23, B33] = b
  const cy0 = (B12 * B13 - B11 * B23) / (B11 * B22 - B12 * B12)
  const lambda = B33 - (B13 * B13 + cy0 * (B12 * B13 - B11 * B23)) / B11
  const fx0 = Math.sqrt(Math.abs(lambda / B11))
  const fy0 = Math.sqrt(Math.abs((lambda * B11) / (B11 * B22 - B12 * B12)))
  const cx0 = -B13 * fx0 * fx0 / lambda
  const K = { fx: fx0, fy: fy0, cx: cx0, cy: cy0 }

  // 每视图外参
  const extr: Extrinsic[] = Hs.map((H) => {
    const h1 = [H[0], H[3], H[6]] as Vec3
    const h2 = [H[1], H[4], H[7]] as Vec3
    const h3 = [H[2], H[5], H[8]] as Vec3
    const invK = (p: Vec3): Vec3 => [(p[0] - K.cx * p[2]) / K.fx, (p[1] - K.cy * p[2]) / K.fy, p[2]]
    const r1 = invK(h1), r2 = invK(h2), t0 = invK(h3)
    let s = 2 / (v3.len(r1) + v3.len(r2))
    // 符号二义性:保证板在相机前方(t_z > 0)
    const sigma = s * t0[2] < 0 ? -1 : 1
    s *= sigma
    const r1n = v3.scale(v3.norm(r1), sigma)
    const r2n = v3.scale(v3.norm(r2), sigma)
    const r3 = v3.cross(r1n, r2n)
    // 正交化
    const r1o = v3.norm(v3.add(r1n, r2n))
    const r2o = v3.norm(v3.cross(r3, r1o))
    const R: Mat3 = [r1o[0], r2o[0], r3[0], r1o[1], r2o[1], r3[1], r1o[2], r2o[2], r3[2]]
    return { rvec: matToRvec(R), t: v3.scale(t0, s) }
  })

  // LM 精化:[fx,fy,k1,k2, 每视图 rvec3+t3],折射显式建模(portDist 固定)
  // 主点固定在传感器中心:平面标定板对主点约束弱,放开会与畸变/折射耦合漂移
  const p0 = [K.fx / N_WATER, K.fy / N_WATER, 0, 0, ...extr.flatMap((e) => [...e.rvec, ...e.t])]
  const projectPt = (p: number[], vi: number, X: Vec3): [number, number] => {
    const [fx, fy, k1, k2] = p
    const cx = imgW / 2, cy = imgH / 2
    const off = 4 + vi * 6
    const R = rodrigues([p[off], p[off + 1], p[off + 2]])
    const t: Vec3 = [p[off + 3], p[off + 4], p[off + 5]]
    const pc = v3.add(m3MulV0(R, X), t)
    const pr = refractPoint(pc, { fx, fy, cx, cy, k1, k2, portDist, nWater: N_WATER })
    if (pr[2] <= 0) return [1e6, 1e6]
    const x = pr[0] / pr[2], y = pr[1] / pr[2]
    const r2 = x * x + y * y
    const s = 1 + k1 * r2 + k2 * r2 * r2
    return [fx * x * s + cx, fy * y * s + cy]
  }
  const m3MulV0 = (m: Mat3, vv: Vec3): Vec3 => [
    m[0] * vv[0] + m[1] * vv[1] + m[2] * vv[2],
    m[3] * vv[0] + m[4] * vv[1] + m[5] * vv[2],
    m[6] * vv[0] + m[7] * vv[1] + m[8] * vv[2],
  ]
  const residual = (p: number[]): number[] => {
    const r: number[] = []
    views.forEach((vw, vi) => {
      vw.points3d.forEach((X, pi) => {
        const [u, v] = projectPt(p, vi, X)
        r.push(u - vw.points2d[pi][0], v - vw.points2d[pi][1])
      })
    })
    return r
  }
  const { p } = lmSolve(residual, p0, 80)

  // 汇总每视图重投影误差
  const outViews = views.map((vw, vi) => {
    const off = 4 + vi * 6
    let se = 0
    vw.points3d.forEach((X, pi) => {
      const [u, v] = projectPt(p, vi, X)
      se += Math.hypot(u - vw.points2d[pi][0], v - vw.points2d[pi][1])
    })
    return {
      rvec: [p[off], p[off + 1], p[off + 2]] as Vec3,
      t: [p[off + 3], p[off + 4], p[off + 5]] as Vec3,
      error: se / vw.points3d.length,
    }
  })
  return {
    fx: p[0], fy: p[1], cx: imgW / 2, cy: imgH / 2, k1: p[2], k2: p[3], portDist,
    views: outViews,
    meanError: outViews.reduce((s, x) => s + x.error, 0) / outViews.length,
  }
}

// 双目:各自闭式+LM 得初值,再联合光束法平差(共享板位姿 + 相对位姿)
export const calibrateStereo = (views: CalibView[], imgW: number, imgH: number, portDist = 0.05): StereoResult => {
  const left = calibrateSingle(views.map((v) => ({ points3d: v.points3d, points2d: v.left })), imgW, imgH, portDist)
  const right = calibrateSingle(views.map((v) => ({ points3d: v.points3d, points2d: v.right })), imgW, imgH, portDist)
  // 初值相对位姿:由共享板位姿合成
  const Rs: Mat3[] = []
  const ts: Vec3[] = []
  views.forEach((_, i) => {
    const Rl = rodrigues(left.views[i].rvec), tl = left.views[i].t
    const Rr = rodrigues(right.views[i].rvec), tr = right.views[i].t
    const R = m3Mul(Rr, m3T(Rl))
    const t = v3.sub(tr, m3MulV0(R, tl))
    Rs.push(R)
    ts.push(t)
  })
  const Rm = new Array(9).fill(0)
  Rs.forEach((R) => R.forEach((x, i) => (Rm[i] += x / Rs.length)))
  const c1: Vec3 = [Rm[0], Rm[3], Rm[6]]
  const c2: Vec3 = [Rm[1], Rm[4], Rm[7]]
  const r1 = v3.norm(c1)
  const r2 = v3.norm(v3.sub(c2, v3.scale(r1, v3.dot(c2, r1))))
  const r3 = v3.cross(r1, r2)
  const relR0: Mat3 = [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]]
  const relT0: Vec3 = [
    ts.reduce((s, t) => s + t[0], 0) / ts.length,
    ts.reduce((s, t) => s + t[1], 0) / ts.length,
    ts.reduce((s, t) => s + t[2], 0) / ts.length,
  ]

  // 联合平差参数:[左 fx,fy,k1,k2, 右 fx,fy,k1,k2, 相对位姿6, 每视图板位姿6(左相机系)]
  // 主点固定传感器中心
  const N = views.length
  const p0 = [
    left.fx, left.fy, left.k1, left.k2,
    right.fx, right.fy, right.k1, right.k2,
    ...matToRvec(relR0), ...relT0,
    ...left.views.flatMap((v) => [...v.rvec, ...v.t]),
  ]
  const projectCam = (intr: number[], pc: Vec3): [number, number] => {
    const [fx, fy, k1, k2] = intr
    const cx = imgW / 2, cy = imgH / 2
    const pr = refractPoint(pc, { fx, fy, cx, cy, k1, k2, portDist, nWater: N_WATER })
    if (pr[2] <= 0) return [1e6, 1e6]
    const x = pr[0] / pr[2], y = pr[1] / pr[2]
    const r2 = x * x + y * y
    const s = 1 + k1 * r2 + k2 * r2 * r2
    return [fx * x * s + cx, fy * y * s + cy]
  }
  const residual = (p: number[]): number[] => {
    const intrL = p.slice(0, 4)
    const intrR = p.slice(4, 8)
    const Rrel = rodrigues([p[8], p[9], p[10]])
    const trel: Vec3 = [p[11], p[12], p[13]]
    const out: number[] = []
    for (let vi = 0; vi < N; vi++) {
      const off = 14 + vi * 6
      const Rv = rodrigues([p[off], p[off + 1], p[off + 2]])
      const tv: Vec3 = [p[off + 3], p[off + 4], p[off + 5]]
      const vw = views[vi]
      for (let pi = 0; pi < vw.points3d.length; pi++) {
        const X = vw.points3d[pi]
        const pL = v3.add(m3MulV0(Rv, X), tv)
        const [ul, vl] = projectCam(intrL, pL)
        out.push(ul - vw.left[pi][0], vl - vw.left[pi][1])
        const pR = v3.add(m3MulV0(Rrel, pL), trel)
        const [ur, vr] = projectCam(intrR, pR)
        out.push(ur - vw.right[pi][0], vr - vw.right[pi][1])
      }
    }
    return out
  }
  const { p } = lmSolve(residual, p0, 60)

  const relR = rodrigues([p[8], p[9], p[10]])
  const relT: Vec3 = [p[11], p[12], p[13]]
  // 回填每视图误差
  const fillErrors = (intrOff: number, side: "left" | "right", tgt: SingleResult): void => {
    const intr = p.slice(intrOff, intrOff + 4)
    const Rrel = rodrigues([p[8], p[9], p[10]])
    const trel: Vec3 = [p[11], p[12], p[13]]
    let total = 0
    views.forEach((vw, vi) => {
      const off = 14 + vi * 6
      const Rv = rodrigues([p[off], p[off + 1], p[off + 2]])
      const tv: Vec3 = [p[off + 3], p[off + 4], p[off + 5]]
      let se = 0
      vw.points3d.forEach((X, pi) => {
        const pL = v3.add(m3MulV0(Rv, X), tv)
        const pc = side === "left" ? pL : v3.add(m3MulV0(Rrel, pL), trel)
        const [u, v] = projectCam(intr, pc)
        se += Math.hypot(u - vw[side][pi][0], v - vw[side][pi][1])
      })
      tgt.views[vi] = { ...tgt.views[vi], error: se / vw.points3d.length }
      total += se / vw.points3d.length
    })
    tgt.meanError = total / views.length
  }
  const leftOut: SingleResult = { fx: p[0], fy: p[1], cx: imgW / 2, cy: imgH / 2, k1: p[2], k2: p[3], portDist, views: left.views, meanError: 0 }
  const rightOut: SingleResult = { fx: p[4], fy: p[5], cx: imgW / 2, cy: imgH / 2, k1: p[6], k2: p[7], portDist, views: right.views, meanError: 0 }
  fillErrors(0, "left", leftOut)
  fillErrors(4, "right", rightOut)
  return { left: leftOut, right: rightOut, relR, relT, baseline: v3.len(relT) }
}

const m3MulV0 = (m: Mat3, vv: Vec3): Vec3 => [
  m[0] * vv[0] + m[1] * vv[1] + m[2] * vv[2],
  m[3] * vv[0] + m[4] * vv[1] + m[5] * vv[2],
  m[6] * vv[0] + m[7] * vv[1] + m[8] * vv[2],
]

// 调试导出
export const homographyDebug = homography
export const intrinsicsDebug = (
  views: { points3d: Vec3[]; points2d: [number, number][] }[],
): number[] => {
  const Hs = views.map((vw) => homography(vw.points3d, vw.points2d))
  const V: number[][] = []
  for (const H of Hs) {
    V.push(vRow(H, 0, 1))
    const v00 = vRow(H, 0, 0), v11 = vRow(H, 1, 1)
    V.push(v00.map((x, i) => x - v11[i]))
  }
  return nullVector(V)
}
