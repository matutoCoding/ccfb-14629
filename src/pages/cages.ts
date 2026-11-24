// 网箱档案:按口建档,挂双目相机
import { db, uid, Cage, CameraRig } from "../db/db"
import { NOMINAL } from "../core/camera"
import { el, icons, toast } from "../ui/ui"

const cageForm = (cage: Cage | null, onSave: () => void): HTMLElement => {
  const c: Cage = cage ?? {
    id: uid(), name: "", circumference: 40, netDepth: 6,
    stockDate: new Date().toISOString().slice(0, 10), species: "大黄鱼",
    fishCount: 4000, createdAt: Date.now(), updatedAt: Date.now(),
  }
  const field = (label: string, key: keyof Cage, type = "text", step = "") =>
    el("div", { class: "field" }, [
      el("label", {}, [label]),
      el("input", { type, value: String(c[key]), step, oninput: (e: Event) => {
        const v = (e.target as HTMLInputElement).value
        ;(c as unknown as Record<string, string | number>)[key] = type === "number" ? Number(v) : v
      } }),
    ])
  const form = el("div", { class: "card" }, [
    el("h3", { class: "card-title" }, [cage ? "编辑网箱" : "新建网箱"]),
    el("div", { class: "form-grid" }, [
      field("名称", "name"),
      field("周长 (m)", "circumference", "number", "1"),
      field("网深 (m)", "netDepth", "number", "0.5"),
      field("放苗日期", "stockDate", "date"),
      field("苗种", "species"),
      field("尾数", "fishCount", "number", "100"),
    ]),
    el("div", { class: "row" }, [
      el("button", { class: "btn primary", onclick: async () => {
        if (!c.name) { toast("请填写网箱名称", "warn"); return }
        c.updatedAt = Date.now()
        await db.cages.put(c)
        toast("已保存")
        onSave()
      } }, ["保存"]),
      el("button", { class: "btn", onclick: () => onSave() }, ["取消"]),
    ]),
  ])
  return form
}

const cameraForm = (cage: Cage, cam: CameraRig | null, onSave: () => void): HTMLElement => {
  const m: CameraRig = cam ?? {
    id: uid(), cageId: cage.id, name: `相机 ${Date.now() % 100}`,
    baseline: 0.12, installDepth: 3, posAngle: 0, yawOffset: 0,
    used: { ...NOMINAL }, calibrated: false, createdAt: Date.now(), updatedAt: Date.now(),
  }
  const field = (label: string, key: keyof CameraRig, step: string) =>
    el("div", { class: "field" }, [
      el("label", {}, [label]),
      el("input", { type: "number", step, value: String(m[key]), oninput: (e: Event) => {
        ;(m as unknown as Record<string, number>)[key] = Number((e.target as HTMLInputElement).value)
      } }),
    ])
  return el("div", { class: "card" }, [
    el("h3", { class: "card-title" }, [`${cam ? "编辑" : "添加"}双目相机 - ${cage.name}`]),
    el("div", { class: "form-grid" }, [
      field("名称", "name", ""),
      field("基线 (m)", "baseline", "0.01"),
      field("安装深度 (m)", "installDepth", "0.5"),
      field("圆周位置 (rad)", "posAngle", "0.1"),
      field("朝向偏航 (rad)", "yawOffset", "0.05"),
    ]),
    el("p", { class: "muted small" }, ["圆周位置:相机挂在网箱圆周上的角度;朝向默认指向圆心,偏航可微调。"]),
    el("div", { class: "row" }, [
      el("button", { class: "btn primary", onclick: async () => {
        m.updatedAt = Date.now()
        await db.cameras.put(m)
        toast("相机已保存")
        onSave()
      } }, ["保存"]),
      el("button", { class: "btn", onclick: () => onSave() }, ["取消"]),
    ]),
  ])
}

export const cagesPage = async (root: HTMLElement): Promise<void> => {
  const render = async () => {
    root.innerHTML = ""
    const cages = await db.cages.list()
    const cameras = await db.cameras.list()
    root.append(
      el("h2", { class: "page-title" }, ["网箱档案"]),
      el("p", { class: "page-desc" }, ["按口建档,记录周长、网深、放苗信息;每口箱可挂 1~4 台双目相机。"]),
      el("div", { class: "row", style: "margin-bottom:var(--sp-4)" }, [
        el("button", { class: "btn primary", onclick: () => {
          root.querySelector("#form-slot")?.replaceWith(cageForm(null, render))
        } }, ["+ 新建网箱"]),
        el("span", { class: "muted small" }, [`共 ${cages.length} 口网箱 / ${cameras.length} 台相机`]),
      ]),
      el("div", { id: "form-slot" }),
    )
    for (const cage of cages.sort((a, b) => a.name.localeCompare(b.name))) {
      const cams = cameras.filter((c) => c.cageId === cage.id)
      const days = Math.max(0, Math.round((Date.now() - new Date(cage.stockDate).getTime()) / 86400000))
      const camRows = cams.map((m) => el("tr", {}, [
        el("td", {}, [m.name]),
        el("td", { class: "num" }, [`${(m.baseline * 1000).toFixed(0)} mm`]),
        el("td", { class: "num" }, [`${m.installDepth} m`]),
        el("td", { class: "num" }, [`${m.posAngle.toFixed(2)} rad`]),
        el("td", {}, [el("span", { class: `tag ${m.calibrated ? "ok" : "warn"}` }, [m.calibrated ? "已标定" : "未标定"])]),
        el("td", {}, [
          el("button", { class: "btn sm", onclick: () => {
            root.querySelector("#form-slot")?.replaceWith(cameraForm(cage, m, render))
          } }, ["编辑"]),
          document.createTextNode(" "),
          el("button", { class: "btn sm danger", onclick: async () => {
            await db.cameras.remove(m.id)
            toast("相机已删除")
            render()
          } }, ["删除"]),
        ]),
      ]))
      root.append(el("div", { class: "card" }, [
        el("div", { class: "row", style: "justify-content:space-between" }, [
          el("h3", { class: "card-title", style: "margin:0" }, [cage.name]),
          el("div", { class: "row" }, [
            el("button", { class: "btn sm", onclick: () => {
              root.querySelector("#form-slot")?.replaceWith(cageForm(cage, render))
            } }, ["编辑"]),
            el("button", { class: "btn sm", onclick: () => {
              if (cams.length >= 4) { toast("每口网箱最多 4 台相机", "warn"); return }
              root.querySelector("#form-slot")?.replaceWith(cameraForm(cage, null, render))
            } }, ["+ 相机"]),
            el("button", { class: "btn sm danger", onclick: async () => {
              await db.cages.remove(cage.id)
              for (const m of cams) await db.cameras.remove(m.id)
              toast("网箱已删除")
              render()
            } }, ["删除"]),
          ]),
        ]),
        el("div", { class: "row", style: "margin:var(--sp-3) 0;color:var(--slate-500)" }, [
          el("span", {}, [`周长 ${cage.circumference} m`]),
          el("span", {}, [`网深 ${cage.netDepth} m`]),
          el("span", {}, [`${cage.species} ${cage.fishCount} 尾`]),
          el("span", {}, [`放苗 ${cage.stockDate}(已养 ${days} 天)`]),
        ]),
        cams.length
          ? el("table", { class: "tbl" }, [
              el("thead", {}, [el("tr", {}, [
                el("th", {}, ["相机"]), el("th", {}, ["基线"]), el("th", {}, ["深度"]),
                el("th", {}, ["位置"]), el("th", {}, ["标定"]), el("th", {}, ["操作"]),
              ])]),
              el("tbody", {}, camRows),
            ])
          : el("p", { class: "muted" }, ["尚未安装相机"]),
      ]))
    }
    if (cages.length === 0) {
      root.append(el("div", { class: "card empty" }, [
        icons.cage(),
        el("div", { class: "t" }, ["还没有网箱"]),
        el("div", {}, ["点击「新建网箱」建立第一口网箱档案"]),
      ]))
    }
  }
  await render()
}
