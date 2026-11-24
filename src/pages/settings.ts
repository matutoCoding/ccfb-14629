// 设置:长重系数、水温、投喂率、参数扰动(故意给错)、数据管理
import { db, getSettings, Settings, DEFAULT_SETTINGS } from "../db/db"
import { SIM_TRUTH, NOMINAL } from "../core/camera"
import { el, toast } from "../ui/ui"

export const settingsPage = async (root: HTMLElement): Promise<void> => {
  const settings = await getSettings()

  const save = async () => {
    await db.settings.put(settings)
    toast("设置已保存")
  }

  const render = async () => {
    root.innerHTML = ""
    root.append(
      el("h2", { class: "page-title" }, ["设置"]),
      el("p", { class: "page-desc" }, ["长重关系、水温与投喂参数;参数扰动用于观察测量误差如何被错误参数放大。"]),
    )

    // 长重关系
    const seasonSel = el("select", { onchange: (e: Event) => {
      settings.season = (e.target as HTMLSelectElement).value as Settings["season"]
      render()
    } }) as HTMLSelectElement
    for (const s of ["春", "夏", "秋", "冬"] as const) {
      const o = el("option", { value: s }, [s])
      if (settings.season === s) o.setAttribute("selected", "")
      seasonSel.append(o)
    }
    const numField = (label: string, get: () => number, set: (v: number) => void, step = "0.001") =>
      el("div", { class: "field" }, [
        el("label", {}, [label]),
        el("input", { type: "number", step, value: String(get()), oninput: (e: Event) => {
          set(Number((e.target as HTMLInputElement).value))
        } }),
      ])
    root.append(el("div", { class: "card" }, [
      el("h3", { class: "card-title" }, ["长重关系 W = a · L^b(按季节)"]),
      el("div", { class: "row", style: "margin-bottom:var(--sp-3)" }, [el("span", { class: "muted" }, ["当前季节:"]), seasonSel]),
      el("div", { class: "form-grid" }, [
        numField(`a(${settings.season})`, () => settings.lwA[settings.season], (v) => (settings.lwA[settings.season] = v), "0.0001"),
        numField(`b(${settings.season})`, () => settings.lwB[settings.season], (v) => (settings.lwB[settings.season] = v), "0.01"),
        numField("水温 (℃)", () => settings.waterTemp, (v) => (settings.waterTemp = v), "0.5"),
        numField("上市规格 (g)", () => settings.marketWeight, (v) => (settings.marketWeight = v), "50"),
      ]),
      el("button", { class: "btn primary", onclick: save }, ["保存"]),
    ]))

    // 投喂率表
    const rateRows = settings.feedRates.map((r, i) => el("tr", {}, [
      el("td", { class: "num" }, [`≤ ${r.maxTemp} ℃`]),
      el("td", { class: "num" }, [
        el("input", { type: "number", step: "0.001", value: String(r.rate), style: "width:90px", oninput: (e: Event) => {
          settings.feedRates[i].rate = Number((e.target as HTMLInputElement).value)
        } }),
      ]),
    ]))
    root.append(el("div", { class: "card" }, [
      el("h3", { class: "card-title" }, ["日投喂率表(占存鱼量)"]),
      el("table", { class: "tbl" }, [
        el("thead", {}, [el("tr", {}, [el("th", {}, ["水温"]), el("th", {}, ["投喂率"])])]),
        el("tbody", {}, rateRows),
      ]),
      el("div", { style: "margin-top:var(--sp-3)" }, [el("button", { class: "btn primary", onclick: save }, ["保存"])]),
    ]))

    // 参数扰动
    const p = settings.perturb
    const slider = (label: string, key: keyof typeof p, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const val = el("span", { class: "val" }, [fmt(p[key])])
      return el("div", { class: "slider-row", style: "margin-bottom:var(--sp-2)" }, [
        el("span", { style: "width:140px" }, [label]),
        el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(p[key]), oninput: (e: Event) => {
          ;(p[key] as number) = Number((e.target as HTMLInputElement).value)
          val.textContent = fmt(p[key])
        } }),
        val,
      ])
    }
    root.append(el("div", { class: "card" }, [
      el("h3", { class: "card-title" }, ["参数扰动(故意给错,看测量怎么偏)"]),
      el("p", { class: "muted small" }, ["扰动叠加在测量用参数上,渲染真值不变;误差会如实反映到「测量记录」的对账里。"]),
      slider("焦距偏移 (%)", "fxPct", -10, 10, 0.5, (v) => `${v.toFixed(1)}%`),
      slider("基线偏移 (%)", "baselinePct", -10, 10, 0.5, (v) => `${v.toFixed(1)}%`),
      slider("玻璃罩距离 (m)", "portDist", -0.05, 0.05, 0.005, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}`),
      slider("折射率偏移", "nWater", -0.1, 0.1, 0.005, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}`),
      slider("畸变 k1 偏移", "k1", -0.1, 0.1, 0.005, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(3)}`),
      el("div", { class: "row", style: "margin-top:var(--sp-3)" }, [
        el("button", { class: "btn primary", onclick: save }, ["保存扰动"]),
        el("button", { class: "btn", onclick: async () => {
          settings.perturb = { ...DEFAULT_SETTINGS.perturb }
          await db.settings.put(settings)
          toast("已恢复无扰动")
          render()
        } }, ["恢复无扰动"]),
      ]),
    ]))

    // 仿真参数对照
    root.append(el("div", { class: "card" }, [
      el("h3", { class: "card-title" }, ["相机参数对照"]),
      el("table", { class: "tbl" }, [
        el("thead", {}, [el("tr", {}, [el("th", {}, ["参数"]), el("th", {}, ["仿真真值(渲染)"]), el("th", {}, ["厂家标称(未标定测量用)"])])]),
        el("tbody", {}, (["fx", "fy", "cx", "cy", "k1", "k2", "portDist", "nWater"] as const).map((k) =>
          el("tr", {}, [
            el("td", {}, [k]),
            el("td", { class: "num" }, [String(SIM_TRUTH[k])]),
            el("td", { class: "num" }, [String(NOMINAL[k])]),
          ]),
        )),
      ]),
    ]))

    // 数据管理
    root.append(el("div", { class: "card" }, [
      el("h3", { class: "card-title" }, ["数据管理"]),
      el("div", { class: "row" }, [
        el("button", { class: "btn danger", onclick: async () => {
          await db.measurements.clear()
          toast("测量记录已清空")
        } }, ["清空测量记录"]),
        el("button", { class: "btn danger", onclick: async () => {
          await db.cages.clear()
          await db.cameras.clear()
          await db.calibrations.clear()
          await db.measurements.clear()
          toast("全部数据已清空,刷新页面重新播种")
        } }, ["重置全部数据"]),
      ]),
    ]))
  }

  await render()
}
