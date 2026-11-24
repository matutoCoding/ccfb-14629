// 相机标定:水下棋盘格采集 + 张正友解算 + 逐张重投影误差剔除
import { db, CameraRig, Cage, Calibration, uid } from "../db/db"
import { IMG_W, IMG_H, SIM_TRUTH } from "../core/camera"
import { captureView, BOARD_COLS, BOARD_ROWS, BOARD_SQUARE } from "../calib/capture"
import { calibrateStereo, CalibView, StereoResult } from "../calib/zhang"
import { el, toast } from "../ui/ui"

interface ViewState {
  view: CalibView
  excluded: boolean
  errL: number | null
  errR: number | null
}

export const calibrationPage = async (root: HTMLElement): Promise<void> => {
  const cages = await db.cages.list()
  const cameras = await db.cameras.list()
  let calibs = await db.calibrations.list()
  let selectedCamId = cameras[0]?.id ?? null
  let views: ViewState[] = []
  let result: StereoResult | null = null

  const render = async () => {
    calibs = await db.calibrations.list()
    root.innerHTML = ""
    root.append(
      el("h2", { class: "page-title" }, ["相机标定"]),
      el("p", { class: "page-desc" }, [
        `水下棋盘格(${BOARD_COLS}×${BOARD_ROWS} 内角点,格距 ${BOARD_SQUARE * 1000} mm)采集 10 组以上,解算内参、畸变与双目外参;重投影误差大的组可剔除后重算。`,
      ]),
    )
    if (cameras.length === 0) {
      root.append(el("div", { class: "notice warn" }, ["请先在「网箱档案」中添加相机"]))
      return
    }
    // 相机选择
    const sel = el("select", { onchange: (e: Event) => {
      selectedCamId = (e.target as HTMLSelectElement).value
      views = []
      result = null
      render()
    } }) as HTMLSelectElement
    for (const c of cameras) {
      const cage = cages.find((g) => g.id === c.cageId)
      const opt = el("option", { value: c.id }, [`${cage?.name ?? "?"} / ${c.name}${c.calibrated ? "(已标定)" : ""}`])
      if (c.id === selectedCamId) opt.setAttribute("selected", "")
      sel.append(opt)
    }
    const cam = cameras.find((c) => c.id === selectedCamId) as CameraRig
    const cage = cages.find((g) => g.id === cam.cageId) as Cage
    const camCalib = calibs.filter((k) => k.cameraId === cam.id).sort((a, b) => b.date - a.date)[0]

    const solveBtn = el("button", { class: "btn primary", onclick: () => {
      const used = views.filter((v) => !v.excluded).map((v) => v.view)
      if (used.length < 4) { toast("至少需要 4 组有效图像", "warn"); return }
      result = calibrateStereo(used, IMG_W, IMG_H, cam.used.portDist)
      // 回填每视图误差
      let li = 0
      for (const v of views) {
        if (v.excluded) continue
        v.errL = result.left.views[li].error
        v.errR = result.right.views[li].error
        li++
      }
      toast(`解算完成,平均重投影误差 左 ${result.left.meanError.toFixed(3)}px / 右 ${result.right.meanError.toFixed(3)}px`)
      render()
    } }, ["开始解算"])
    if (views.filter((v) => !v.excluded).length < 4) solveBtn.setAttribute("disabled", "")

    root.append(el("div", { class: "card" }, [
      el("div", { class: "row" }, [
        el("span", { class: "muted" }, ["选择相机:"]), sel,
        el("button", { class: "btn primary", onclick: () => {
          const v = captureView(cam, cage)
          if (!v) { toast("未能拍到完整棋盘格,请重试", "warn"); return }
          views.push({ view: v, excluded: false, errL: null, errR: null })
          result = null
          render()
        } }, ["拍摄一组"]),
        el("button", { class: "btn", onclick: () => {
          let added = 0
          for (let i = 0; i < 5; i++) {
            const v = captureView(cam, cage)
            if (v) { views.push({ view: v, excluded: false, errL: null, errR: null }); added++ }
          }
          result = null
          toast(`连拍完成,新增 ${added} 组`)
          render()
        } }, ["连拍 5 组"]),
        solveBtn,
        el("span", { class: "muted small" }, [`已采集 ${views.length} 组,有效 ${views.filter((v) => !v.excluded).length} 组`]),
      ]),
    ]))

    // 采集列表
    if (views.length > 0) {
      const rows = views.map((v, i) => {
        const bad = v.errL !== null && (v.errL > 1.0 || (v.errR ?? 0) > 1.0)
        return el("tr", {}, [
          el("td", {}, [`#${i + 1}`]),
          el("td", {}, [thumbCanvas(v.view.left)]),
          el("td", { class: "num" }, [v.errL === null ? "-" : `${v.errL.toFixed(3)} px`]),
          el("td", { class: "num" }, [v.errR === null ? "-" : `${v.errR!.toFixed(3)} px`]),
          el("td", {}, [bad && !v.excluded ? el("span", { class: "tag danger" }, ["误差偏大"]) : el("span", { class: "tag ok" }, ["正常"])]),
          el("td", {}, [
            el("button", { class: "btn sm", onclick: () => {
              v.excluded = !v.excluded
              result = null
              for (const w of views) { w.errL = null; w.errR = null }
              render()
            } }, [v.excluded ? "恢复" : "剔除"]),
          ]),
        ])
      })
      root.append(el("div", { class: "card" }, [
        el("h3", { class: "card-title" }, ["采集图像与重投影误差"]),
        el("table", { class: "tbl" }, [
          el("thead", {}, [el("tr", {}, [
            el("th", {}, ["组"]), el("th", {}, ["左图角点"]), el("th", {}, ["左误差"]),
            el("th", {}, ["右误差"]), el("th", {}, ["状态"]), el("th", {}, ["操作"]),
          ])]),
          el("tbody", {}, rows),
        ]),
      ]))
    }

    // 解算结果
    if (result) {
      const r: StereoResult = result
      const diff = (a: number, b: number) => `${a.toFixed(2)}(真值 ${b})`
      root.append(el("div", { class: "card" }, [
        el("h3", { class: "card-title" }, ["解算结果(与仿真真值对照)"]),
        el("table", { class: "tbl" }, [
          el("tbody", {}, [
            tr2("fx", diff(r.left.fx, SIM_TRUTH.fx), diff(r.right.fx, SIM_TRUTH.fx)),
            tr2("fy", diff(r.left.fy, SIM_TRUTH.fy), diff(r.right.fy, SIM_TRUTH.fy)),
            tr2("cx", diff(r.left.cx, SIM_TRUTH.cx), diff(r.right.cx, SIM_TRUTH.cx)),
            tr2("cy", diff(r.left.cy, SIM_TRUTH.cy), diff(r.right.cy, SIM_TRUTH.cy)),
            tr2("k1", diff(r.left.k1, SIM_TRUTH.k1), diff(r.right.k1, SIM_TRUTH.k1)),
            tr2("k2", diff(r.left.k2, SIM_TRUTH.k2), diff(r.right.k2, SIM_TRUTH.k2)),
            tr2("玻璃罩距离 (m)", diff(r.left.portDist, SIM_TRUTH.portDist), diff(r.right.portDist, SIM_TRUTH.portDist)),
            tr2("基线 (m)", `${r.baseline.toFixed(4)}(真值 0.1200)`, "-"),
            tr2("平均误差 (px)", r.left.meanError.toFixed(3), r.right.meanError.toFixed(3)),
          ]),
        ]),
        el("div", { class: "row", style: "margin-top:var(--sp-3)" }, [
          el("button", { class: "btn primary", onclick: async () => {
            const rr = r
            const calib: Calibration = {
              id: uid(), cameraId: cam.id, date: Date.now(),
              result: {
                fx: rr.left.fx, fy: rr.left.fy, cx: rr.left.cx, cy: rr.left.cy,
                k1: rr.left.k1, k2: rr.left.k2, portDist: rr.left.portDist,
                relR: rr.relR, relT: rr.relT, baseline: rr.baseline,
              },
              viewErrors: views.map((v, i) => ({ index: i, left: v.errL ?? 0, right: v.errR ?? 0, excluded: v.excluded })),
              meanError: (rr.left.meanError + rr.right.meanError) / 2,
            }
            await db.calibrations.put(calib)
            // 标定结果写入相机使用参数,折射显式建模(水折射率取物理常数)
            cam.used = {
              fx: rr.left.fx, fy: rr.left.fy, cx: rr.left.cx, cy: rr.left.cy,
              k1: rr.left.k1, k2: rr.left.k2, portDist: rr.left.portDist, nWater: 1.333,
            }
            cam.baseline = rr.baseline
            cam.calibrated = true
            cam.updatedAt = Date.now()
            await db.cameras.put(cam)
            toast("标定结果已保存并启用")
            render()
          } }, ["保存并启用"]),
          el("span", { class: "muted small" }, ["保存后测量链路将使用解算参数(折射由等效内参吸收)"]),
        ]),
      ]))
    } else if (camCalib) {
      root.append(el("div", { class: "card" }, [
        el("h3", { class: "card-title" }, ["当前生效标定"]),
        el("p", { class: "muted small" }, [
          `保存于 ${new Date(camCalib.date).toLocaleString()},平均重投影误差 ${camCalib.meanError.toFixed(3)} px,` +
          `fx=${camCalib.result.fx.toFixed(1)},基线=${camCalib.result.baseline.toFixed(4)} m`,
        ]),
      ]))
    }
  }

  const tr2 = (k: string, l: string, r: string) =>
    el("tr", {}, [el("td", {}, [k]), el("td", { class: "num" }, [l]), el("td", { class: "num" }, [r])])

  // 左图角点缩略图
  const thumbCanvas = (pts: [number, number][]): HTMLCanvasElement => {
    const cv = el("canvas", { width: "160", height: "90", style: "background:#0f172a;border-radius:4px" }) as HTMLCanvasElement
    const ctx = cv.getContext("2d")!
    ctx.fillStyle = "#22d3ee"
    const s = 160 / IMG_W
    for (const [u, v] of pts) ctx.fillRect(u * s - 1, v * s - 1, 2, 2)
    return cv
  }

  await render()
}
