// 测量记录:列表、真值对账、体长分布直方图
import { db, Cage, Measurement } from "../db/db"
import { el, toast, drawHistogram, fmtDate } from "../ui/ui"

export const recordsPage = async (root: HTMLElement): Promise<void> => {
  const cages = await db.cages.list()
  const cameras = await db.cameras.list()
  let filterCage = "all"

  const render = async () => {
    root.innerHTML = ""
    root.append(
      el("h2", { class: "page-title" }, ["测量记录"]),
      el("p", { class: "page-desc" }, ["仿真环境下每条鱼的真实叉长已知,自动对账列出误差,观察整体偏大还是偏小。"]),
    )
    const sel = el("select", { onchange: (e: Event) => {
      filterCage = (e.target as HTMLSelectElement).value
      render()
    } }) as HTMLSelectElement
    sel.append(el("option", { value: "all" }, ["全部网箱"]))
    for (const c of cages) sel.append(el("option", { value: c.id }, [c.name]))
    sel.value = filterCage

    const all = (await db.measurements.list()).sort((a, b) => b.date - a.date)
    const ms = filterCage === "all" ? all : all.filter((m) => m.cageId === filterCage)
    const withTruth = ms.filter((m) => m.trueLength !== null)
    const errors = withTruth.map((m) => ((m.forkLength - m.trueLength!) / m.trueLength!) * 100)
    const meanAbs = errors.length ? errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length : 0
    const bias = errors.length ? errors.reduce((s, e) => s + e, 0) / errors.length : 0
    const meanLen = ms.length ? ms.reduce((s, m) => s + m.forkLength, 0) / ms.length : 0
    const meanWt = ms.length ? ms.reduce((s, m) => s + m.weight, 0) / ms.length : 0

    root.append(el("div", { class: "row", style: "margin-bottom:var(--sp-4)" }, [
      el("span", { class: "muted" }, ["网箱:"]), sel,
      el("button", { class: "btn danger", onclick: async () => {
        for (const m of ms) await db.measurements.remove(m.id)
        toast(`已清除 ${ms.length} 条记录`)
        render()
      } }, ["清除当前筛选记录"]),
    ]))

    // 统计条
    const errCls = meanAbs <= 2 ? "ok" : meanAbs <= 5 ? "warn" : "danger"
    root.append(el("div", { class: "stat-row", style: "margin-bottom:var(--sp-4)" }, [
      stat(`${ms.length}`, "样本数"),
      stat(`${meanLen.toFixed(1)} cm`, "平均叉长"),
      stat(`${meanWt.toFixed(0)} g`, "平均体重"),
      stat(`${meanAbs.toFixed(2)}%`, "平均误差(对账)", errCls),
      stat(`${bias >= 0 ? "+" : ""}${bias.toFixed(2)}%`, bias > 0.3 ? "系统偏大" : bias < -0.3 ? "系统偏小" : "无明显偏差", Math.abs(bias) <= 0.5 ? "ok" : "warn"),
    ]))

    if (ms.length > 0 && ms.length < 30) {
      root.append(el("div", { class: "notice warn" }, [
        `样本量仅 ${ms.length} 条,统计意义不足,建议至少 30 条以上再评估体长分布与均重。`,
      ]))
    }

    // 直方图
    if (ms.length > 0) {
      const cv = el("canvas", { class: "chart" }) as HTMLCanvasElement
      root.append(el("div", { class: "card" }, [
        el("h3", { class: "card-title" }, ["叉长分布"]),
        cv,
      ]))
      requestAnimationFrame(() => drawHistogram(cv, ms.map((m) => m.forkLength), 2, "叉长 (cm)"))
    }

    // 明细表
    if (ms.length === 0) {
      root.append(el("div", { class: "card empty" }, [
        el("div", { class: "t" }, ["暂无测量记录"]),
        el("div", {}, ["到「双目画面」页手动或自动测量"]),
      ]))
      return
    }
    const rows = ms.slice(0, 200).map((m) => {
      const err = m.trueLength !== null ? ((m.forkLength - m.trueLength) / m.trueLength) * 100 : null
      const cageName = cages.find((c) => c.id === m.cageId)?.name ?? "?"
      const camName = cameras.find((c) => c.id === m.cameraId)?.name ?? "?"
      return el("tr", {}, [
        el("td", {}, [fmtDate(m.date)]),
        el("td", {}, [cageName]),
        el("td", {}, [camName]),
        el("td", {}, [el("span", { class: `tag ${m.type === "auto" ? "accent" : ""}` }, [m.type === "auto" ? "自动" : "手动"])]),
        el("td", { class: "num" }, [`${m.forkLength.toFixed(1)} cm`]),
        el("td", { class: "num" }, [`${m.weight.toFixed(0)} g`]),
        el("td", { class: "num" }, [m.trueLength !== null ? `${m.trueLength.toFixed(1)} cm` : "-"]),
        el("td", { class: "num" }, [err !== null
          ? el("span", { class: `tag ${Math.abs(err) <= 2 ? "ok" : Math.abs(err) <= 5 ? "warn" : "danger"}` }, [`${err >= 0 ? "+" : ""}${err.toFixed(2)}%`])
          : "-"]),
        el("td", { class: "num" }, [`${(m.confidence * 100).toFixed(0)}%`]),
        el("td", {}, [el("button", { class: "btn sm danger", onclick: async () => {
          await db.measurements.remove(m.id)
          render()
        } }, ["删"])]),
      ])
    })
    root.append(el("div", { class: "card" }, [
      el("h3", { class: "card-title" }, [`明细(最近 ${Math.min(200, ms.length)} 条)`]),
      el("table", { class: "tbl" }, [
        el("thead", {}, [el("tr", {}, [
          el("th", {}, ["时间"]), el("th", {}, ["网箱"]), el("th", {}, ["相机"]), el("th", {}, ["方式"]),
          el("th", {}, ["叉长"]), el("th", {}, ["体重"]), el("th", {}, ["真值"]), el("th", {}, ["误差"]),
          el("th", {}, ["置信度"]), el("th", {}, [""]),
        ])]),
        el("tbody", {}, rows),
      ]),
    ]))
  }

  const stat = (v: string, k: string, cls = "") =>
    el("div", { class: "stat" }, [el("div", { class: `v ${cls}` }, [v]), el("div", { class: "k" }, [k])])

  await render()
}
