// 向量/矩阵基础,相机约定:相机空间 +Z 朝前,右手系
export type Vec3 = [number, number, number]
export type Mat3 = number[] // 9,行主序
export type Mat4 = number[] // 16,列主序(WebGPU 约定)

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  },
  dist: (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
}

// 绕 Y 轴旋转(水平朝向),yaw=0 朝 +Z
export const rotY = (yaw: number): Mat3 => {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}

export const m3MulV = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]

export const m3Mul = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}

export const m3T = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]

// 罗德里格斯:旋转向量 -> 旋转矩阵
export const rodrigues = (r: Vec3): Mat3 => {
  const th = v3.len(r)
  if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const [x, y, z] = v3.scale(r, 1 / th)
  const c = Math.cos(th), s = Math.sin(th), C = 1 - c
  return [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ]
}

// 旋转矩阵 -> 旋转向量
export const matToRvec = (m: Mat3): Vec3 => {
  const tr = m[0] + m[4] + m[8]
  let th = Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)))
  if (th < 1e-9) return [0, 0, 0]
  const s = 2 * Math.sin(th)
  return [(m[7] - m[5]) / s * th, (m[2] - m[6]) / s * th, (m[3] - m[1]) / s * th]
}

// 高斯消元(部分主元),解 Ax=b
export const solveLinear = (A: number[][], b: number[]): number[] => {
  const n = A.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-14) continue
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row, i) => row[n] / (M[i][i] || 1e-14))
}

// Jacobi 法求对称矩阵特征值/特征向量,返回按特征值升序
export const jacobiEigen = (Ain: number[][]): { values: number[]; vectors: number[][] } => {
  const n = Ain.length
  const A = Ain.map((r) => [...r])
  let V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  )
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q]
    if (off < 1e-20) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue
        const theta = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p])
        const c = Math.cos(theta), s = Math.sin(theta)
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q]
          A[k][p] = c * akp - s * akq
          A[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k]
          A[p][k] = c * apk - s * aqk
          A[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q]
          V[k][p] = c * vkp - s * vkq
          V[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[a][a] - A[b][b])
  return {
    values: idx.map((i) => A[i][i]),
    vectors: idx.map((i) => V.map((row) => row[i])),
  }
}

// A^T A 最小特征向量(齐次最小二乘)
export const nullVector = (A: number[][]): number[] => {
  const n = A[0].length
  const AtA: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (const row of A)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) AtA[i][j] += row[i] * row[j]
  return jacobiEigen(AtA).vectors[0]
}

// Levenberg-Marquardt,数值雅可比
export const lmSolve = (
  residual: (p: number[]) => number[],
  p0: number[],
  maxIter = 60,
): { p: number[]; rms: number } => {
  let p = [...p0]
  let r = residual(p)
  let cost = r.reduce((s, x) => s + x * x, 0)
  let lambda = 1e-3
  const n = p.length
  for (let it = 0; it < maxIter; it++) {
    const J: number[][] = r.map(() => new Array(n).fill(0))
    for (let j = 0; j < n; j++) {
      const h = Math.max(1e-7, Math.abs(p[j]) * 1e-6)
      const pj = [...p]
      pj[j] += h
      const rj = residual(pj)
      for (let i = 0; i < r.length; i++) J[i][j] = (rj[i] - r[i]) / h
    }
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    const Jtr = new Array(n).fill(0)
    for (let i = 0; i < r.length; i++)
      for (let a = 0; a < n; a++) {
        Jtr[a] += J[i][a] * r[i]
        for (let b = 0; b < n; b++) JtJ[a][b] += J[i][a] * J[i][b]
      }
    let improved = false
    for (let attempt = 0; attempt < 12; attempt++) {
      const A = JtJ.map((row, i) => row.map((x, j) => (i === j ? x + lambda * Math.max(x, 1e-6) : x)))
      const delta = solveLinear(A, Jtr.map((x) => -x))
      const pn = p.map((x, i) => x + delta[i])
      const rn = residual(pn)
      const costN = rn.reduce((s, x) => s + x * x, 0)
      if (costN < cost) {
        p = pn; r = rn; cost = costN
        lambda = Math.max(1e-7, lambda / 3)
        improved = true
        break
      }
      lambda *= 5
    }
    if (!improved) break
  }
  return { p, rms: Math.sqrt(cost / r.length) }
}

// 正态分布采样(Box-Muller)
export const randNormal = (mean: number, std: number): number => {
  const u = Math.max(Math.random(), 1e-12)
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
