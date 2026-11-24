// 生长分析:体重曲线、日增重、上市预估、投喂建议
import { db, getSettings } from "../db/db"
import { el, drawLineChart } from "../ui/ui"

export const growthPage = async (root: HTMLElement): Promise<void> => {
  const cages = await db.cages.list()
  const settings = await getSettings()
  let filterCage = cages[0]?.id ?? "all"

  const render = async () => {
    root.innerHTML = ""
    root.append(
      el("h2", { class: "page-title" }, ["生长分析"]),
      el("p", { class: "page-desc" }, ["把每次测量连成曲线,估日增重与上市时间,按存鱼量和水温推荐投喂量。"]),
    )
    if (cages.length === 0) {
      root.append(el("div", { class: "notice warn" }, ["请先建立网箱档案"]))
      return
    }
    const sel = el("select", { onchange: (e: Event) => {
      filterCage = (e.target as HTMLSelectElement).value
      render()
    } }) as HTMLSelectElement
    for (const c of cages) sel.append(el("option", { value: c.id }, [c.name]))
    sel.value = filterCage
    root.append(el("div", { class: "row", style: "margin-bottom:var(--sp-4)" }, [el("span", { class: "muted" }, ["网箱:"]), sel]))

    const cage = cages.find((c) => c.id === filterCage) ?? cages[0]
    const ms = (await db.measurements.list()).filter((m) => m.cageId === cage.id).sort((a, b) => a.date - b.date)

    if (ms.length < 5) {
      root.append(el("div", { class: "notice warn" }, [
        `该网箱仅 ${ms.length} 条测量记录,至少积累数次测量(建议 5 条以上、跨多天)后才能分析生长趋势。`,
      ]))
      if (ms.length === 0) return
    }

    // 按天聚合均重
    const byDay = new Map<string, { sum: number; n: number; t: number }>()
    for (const m of ms) {
      const key = new Date(m.date).toISOString().slice(0, 10)
      const cur = byDay.get(key) ?? { sum: 0, n: 0, t: m.date }
      cur.sum += m.weight
      cur.n++
      cur.t = Math.min(cur.t, m.date)
      byDay.set(key, cur)
    }
    const points = [...byDay.values()].sort((a, b) => a.t - b.t).map((d) => ({ x: d.t, y: d.sum / d.n }))
    const curWt = points[points.length - 1].y

    // 日增重:线性回归(g/天)
    let dailyGain = 0
    if (points.length >= 2) {
      const n = points.length
      const sx = points.reduce((s, p) => s + p.x, 0)
      const sy = points.reduce((s, p) => s + p.y, 0)
      const sxy = points.reduce((s, p) => s + p.x * p.y, 0)
      const sxx = points.reduce((s, p) => s + p.x * p.x, 0)
      dailyGain = ((n * sxy - sx * sy) / Math.max(n * sxx - sx * sx, 1)) / 86400000
    }
    const remain = settings.marketWeight - curWt
    const daysToMarket = dailyGain > 0.1 ? Math.ceil(remain / dailyGain) : null

    // 投喂建议
    const biomass = (cage.fishCount * curWt) / 1000 // kg
    const rate = settings.feedRates.find((r) => settings.waterTemp <= r.maxTemp)?.rate ?? 0.015
    const dailyFeed = biomass * rate

    root.append(el("div", { class: "stat-row", style: "margin-bottom:var(--sp-4)" }, [
      stat(`${curWt.toFixed(0)} g`, "当前均重"),
      stat(dailyGain > 0 ? `${dailyGain.toFixed(2)} g/天` : "-", "日增重"),
      stat(daysToMarket !== null && remain > 0 ? `${daysToMarket} 天` : remain <= 0 ? "已达规格" : "-", `距上市 ${settings.marketWeight}g`),
      stat(`${biomass.toFixed(0)} kg`, "估算存鱼量"),
      stat(`${dailyFeed.toFixed(1)} kg/天`, `投喂建议(水温 ${settings.waterTemp}℃,${(rate * 100).toFixed(1)}%)`, "ok"),
    ]))

    if (points.length >= 2) {
      const cv = el("canvas", { class: "chart" }) as HTMLCanvasElement
      root.append(el("div", { class: "card" }, [
        el("h3", { class: "card-title" }, ["平均体重曲线"]),
        cv,
      ]))
      requestAnimationFrame(() => drawLineChart(cv, points, "均重 (g)"))
    }

    root.append(el("div", { class: "card" }, [
      el("h3", { class: "card-title" }, ["投喂建议说明"]),
      el("p", { class: "muted small" }, [
        `存鱼量 = 在箱尾数 ${cage.fishCount} × 当前均重 ${curWt.toFixed(0)} g ≈ ${biomass.toFixed(0)} kg;` +
        `日投喂率按水温 ${settings.waterTemp}℃ 取 ${(rate * 100).toFixed(1)}%,即每天 ${dailyFeed.toFixed(1)} kg,建议分 2~3 餐。` +
        `水温和投喂率表可在「设置」中调整。`,
      ]),
    ]))
  }

  const stat = (v: string, k: string, cls = "") =>
    el("div", { class: "stat" }, [el("div", { class: `v ${cls}` }, [v]), el("div", { class: "k" }, [k])])

  await render()
}
