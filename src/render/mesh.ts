// 程序化网格:大黄鱼(单位长,吻端 x=0,尾叉 x=1)、网箱网衣、海底
export interface Mesh {
  vertices: Float32Array // pos3 + nrm3 + col3
  indices: Uint32Array
}

const STRIDE = 9

// 体高剖面(半高,单位体长)
const profile = (t: number): number => {
  if (t < 0.55) return 0.13 * Math.pow(Math.sin((Math.PI / 2) * (t / 0.55)), 0.9)
  return 0.13 * Math.max(0, 1 - Math.pow((t - 0.55) / 0.45, 1.6))
}

export const buildFishMesh = (): Mesh => {
  const verts: number[] = []
  const idx: number[] = []
  const NR = 14, NS = 10
  const back: [number, number, number] = [0.62, 0.5, 0.22] // 金黄背部
  const belly: [number, number, number] = [0.82, 0.83, 0.8] // 银白腹部
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: [number, number, number]) => {
    verts.push(x, y, z, nx, ny, nz, c[0], c[1], c[2])
    return verts.length / STRIDE - 1
  }
  const bodyColor = (y: number, h: number): [number, number, number] => {
    const t = Math.min(1, Math.max(0, y / (h || 1) * 0.5 + 0.5))
    return [belly[0] + (back[0] - belly[0]) * t, belly[1] + (back[1] - belly[1]) * t, belly[2] + (back[2] - belly[2]) * t]
  }
  // 体环
  const ringStart: number[] = []
  for (let i = 0; i <= NR; i++) {
    const t = 0.02 + (i / NR) * 0.93 // 0.02 ~ 0.95
    const h = profile(t)
    const w = h * 0.5
    const yOff = -0.1 * h
    ringStart.push(verts.length / STRIDE)
    for (let j = 0; j < NS; j++) {
      const th = (j / NS) * Math.PI * 2
      const y = Math.cos(th) * h + yOff
      const z = Math.sin(th) * w
      push(t, y, z, 0, Math.cos(th), Math.sin(th), bodyColor(y - yOff, h))
    }
  }
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NS; j++) {
      const a = ringStart[i] + j
      const b = ringStart[i] + ((j + 1) % NS)
      const c = ringStart[i + 1] + j
      const d = ringStart[i + 1] + ((j + 1) % NS)
      idx.push(a, c, b, b, c, d)
    }
  }
  // 吻端锥
  const snout = push(0, -0.005, 0, -1, 0, 0, bodyColor(0, 0.1))
  for (let j = 0; j < NS; j++) idx.push(snout, ringStart[0] + ((j + 1) % NS), ringStart[0] + j)
  // 尾柄收口(尾叉凹口 x=1.0)
  const ped = push(1.0, 0, 0, 1, 0, 0, bodyColor(0, 0.1))
  const last = ringStart[NR]
  for (let j = 0; j < NS; j++) idx.push(ped, last + j, last + ((j + 1) % NS))
  // 尾鳍上下叶(叉形,凹口在 x=1.0)
  const finC: [number, number, number] = [0.55, 0.48, 0.28]
  const f0 = push(0.95, 0, 0, 0, 0, 1, finC)
  const f1 = push(1.1, 0.055, 0, 0, 0, 1, finC)
  const f2 = push(1.0, 0, 0, 0, 0, 1, finC)
  const f3 = push(1.1, -0.055, 0, 0, 0, 1, finC)
  idx.push(f0, f1, f2, f0, f2, f3)
  // 背鳍
  const d0 = push(0.32, profile(0.32) * 0.9, 0, 0, 0, 1, finC)
  const d1 = push(0.5, profile(0.5) + 0.045, 0, 0, 0, 1, finC)
  const d2 = push(0.68, profile(0.68) * 0.9, 0, 0, 0, 1, finC)
  idx.push(d0, d1, d2)
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) }
}

export interface LineMesh {
  vertices: Float32Array // pos3 + col3
  indices: Uint32Array
}

// 网箱网衣:圆柱网格线
export const buildNetMesh = (circumference: number, depth: number): LineMesh => {
  const R = circumference / (2 * Math.PI)
  const verts: number[] = []
  const idx: number[] = []
  const col: [number, number, number] = [0.2, 0.28, 0.25]
  const push = (x: number, y: number, z: number) => {
    verts.push(x, y, z, col[0], col[1], col[2])
    return verts.length / 6 - 1
  }
  const NV = 28, NH = 7
  for (let i = 0; i < NV; i++) {
    const a = (i / NV) * Math.PI * 2
    const top = push(Math.cos(a) * R, 0, Math.sin(a) * R)
    const bot = push(Math.cos(a) * R, -depth, Math.sin(a) * R)
    idx.push(top, bot)
  }
  for (let j = 0; j <= NH; j++) {
    const y = -(j / NH) * depth
    for (let i = 0; i < NV; i++) {
      const a0 = (i / NV) * Math.PI * 2
      const a1 = ((i + 1) / NV) * Math.PI * 2
      idx.push(push(Math.cos(a0) * R, y, Math.sin(a0) * R), push(Math.cos(a1) * R, y, Math.sin(a1) * R))
    }
  }
  // 底网
  for (let i = 0; i < NV; i++) {
    const a = (i / NV) * Math.PI * 2
    idx.push(push(0, -depth, 0), push(Math.cos(a) * R, -depth, Math.sin(a) * R))
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) }
}

// 海底沙地
export const buildSeabed = (y: number, size: number): Mesh => {
  const c: [number, number, number] = [0.35, 0.32, 0.24]
  const h = size / 2
  const vertices = new Float32Array([
    -h, y, -h, 0, 1, 0, ...c,
    h, y, -h, 0, 1, 0, ...c,
    h, y, h, 0, 1, 0, ...c,
    -h, y, h, 0, 1, 0, ...c,
  ])
  return { vertices, indices: new Uint32Array([0, 2, 1, 0, 3, 2]) }
}
