// UI 基础:DOM 助手、线性图标、图表、提示
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | EventListener> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v as string
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v as EventListener)
    else node.setAttribute(k, v as string)
  }
  for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c)
  return node
}

// 统一线宽 1.6 的线性图标
const svg = (paths: string): SVGSVGElement => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  s.setAttribute("viewBox", "0 0 24 24")
  s.setAttribute("fill", "none")
  s.setAttribute("stroke", "currentColor")
  s.setAttribute("stroke-width", "1.6")
  s.setAttribute("stroke-linecap", "round")
  s.setAttribute("stroke-linejoin", "round")
  s.innerHTML = paths
  return s as SVGSVGElement
}

export const icons = {
  cage: () => svg('<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18M9 4v14M15 4v14"/><path d="M7 21h10"/>'),
  calib: () => svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  stereo: () => svg('<rect x="2" y="7" width="20" height="11" rx="2"/><circle cx="8.5" cy="12.5" r="2.5"/><circle cx="15.5" cy="12.5" r="2.5"/>'),
  records: () => svg('<path d="M8 3h8l1 3h3v15H4V6h3z"/><path d="M9 11h6M9 15h4"/>'),
  growth: () => svg('<path d="M3 20h18"/><path d="M4 16l4-6 4 3 5-8 3 4"/><circle cx="8" cy="10" r="1.2"/><circle cx="17" cy="5" r="1.2"/>'),
  settings: () => svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  fish: () => svg('<path d="M3 12c3-4 7-6 10-6 4 0 7 3 8 6-1 3-4 6-8 6-3 0-7-2-10-6z"/><circle cx="16.5" cy="10.5" r="0.8"/><path d="M3 12l3-2M3 12l3 2"/>'),
}

export const toast = (msg: string, kind: "info" | "warn" | "error" = "info"): void => {
  const t = el("div", { class: `notice ${kind}`, style: `position:fixed;top:16px;right:16px;z-index:99;box-shadow:var(--shadow-lg);background:#fff;max-width:360px` }, [msg])
  document.body.append(t)
  setTimeout(() => t.remove(), 3600)
}

// 直方图
export const drawHistogram = (canvas: HTMLCanvasElement, values: number[], binSize: number, unit: string): void => {
  const ctx = canvas.getContext("2d")!
  const W = (canvas.width = canvas.clientWidth * 2)
  const H = (canvas.height = 360)
  ctx.scale(1, 1)
  ctx.clearRect(0, 0, W, H)
  if (values.length === 0) return
  const lo = Math.floor(Math.min(...values) / binSize) * binSize
  const hi = Math.ceil(Math.max(...values) / binSize) * binSize
  const bins = Math.max(1, Math.round((hi - lo) / binSize))
  const counts = new Array(bins).fill(0)
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / binSize))]++
  const maxC = Math.max(...counts)
  const padL = 60, padB = 48, padT = 20
  const bw = (W - padL - 20) / bins
  ctx.fillStyle = "#0e7490"
  counts.forEach((c, i) => {
    const h = (c / maxC) * (H - padT - padB)
    ctx.fillRect(padL + i * bw + 2, H - padB - h, bw - 4, h)
  })
  ctx.fillStyle = "#64748b"
  ctx.font = "20px sans-serif"
  ctx.textAlign = "center"
  for (let i = 0; i <= bins; i += Math.ceil(bins / 8)) {
    const x = padL + i * bw
    ctx.fillText(`${(lo + i * binSize).toFixed(0)}`, x, H - padB + 28)
  }
  ctx.fillText(unit, padL + (W - padL) / 2, H - 8)
  ctx.textAlign = "right"
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((maxC * i) / 4)
    const y = H - padB - (i / 4) * (H - padT - padB)
    ctx.fillText(`${v}`, padL - 8, y + 6)
    ctx.strokeStyle = "#e2e8f0"
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(W - 20, y)
    ctx.stroke()
  }
}

// 折线图(生长曲线):points = [{x: 时间戳, y: 值}]
export const drawLineChart = (
  canvas: HTMLCanvasElement,
  points: { x: number; y: number }[],
  yLabel: string,
): void => {
  const ctx = canvas.getContext("2d")!
  const W = (canvas.width = canvas.clientWidth * 2)
  const H = (canvas.height = 360)
  ctx.clearRect(0, 0, W, H)
  if (points.length === 0) return
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = 0, y1 = Math.max(...ys) * 1.15
  const padL = 80, padB = 56, padT = 20
  const X = (x: number) => padL + ((x - x0) / Math.max(x1 - x0, 1)) * (W - padL - 30)
  const Y = (y: number) => H - padB - ((y - y0) / (y1 - y0)) * (H - padT - padB)
  ctx.strokeStyle = "#e2e8f0"
  ctx.fillStyle = "#64748b"
  ctx.font = "20px sans-serif"
  ctx.textAlign = "right"
  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) * i) / 4
    ctx.fillText(v.toFixed(0), padL - 8, Y(v) + 6)
    ctx.beginPath()
    ctx.moveTo(padL, Y(v))
    ctx.lineTo(W - 30, Y(v))
    ctx.stroke()
  }
  ctx.textAlign = "center"
  const fmt = (t: number) => {
    const d = new Date(t)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  for (let i = 0; i <= 5; i++) {
    const t = x0 + ((x1 - x0) * i) / 5
    ctx.fillText(fmt(t), X(t), H - padB + 28)
  }
  ctx.fillText(yLabel, padL + (W - padL) / 2, H - 8)
  ctx.strokeStyle = "#0e7490"
  ctx.lineWidth = 3
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))))
  ctx.stroke()
  ctx.fillStyle = "#0e7490"
  for (const p of points) {
    ctx.beginPath()
    ctx.arc(X(p.x), Y(p.y), 5, 0, Math.PI * 2)
    ctx.fill()
  }
}

export const fmtDate = (t: number): string => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
