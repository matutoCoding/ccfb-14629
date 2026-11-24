// 双目画面:实时渲染、手动/分段测量、自动测量
import { db, Cage, CameraRig, Measurement, uid, getSettings, Settings } from "../db/db"
import { Renderer, View, VIEW_W, VIEW_H } from "../render/renderer"
import { SIM_TRUTH, IMG_W, IMG_H, project } from "../core/camera"
import { spawnSchool, updateSchool, Fish, fishSpinePoint } from "../sim/fish"
import { computeEnvironment } from "../sim/scene"
import {
  effectiveParams, usedRigPoses, trueRigPoses,
  triangulatePoint, stereoLength, measureSegmented, nccMatch, autoMeasure, epipolarLine,
} from "../measure/measure"
import { el, toast } from "../ui/ui"
import { v3, Vec3 } from "../core/math"

interface PairUI {
  cam: CameraRig
  viewL: View
  viewR: View
  overlayL: HTMLCanvasElement
  overlayR: HTMLCanvasElement
}

export const stereoPage = async (root: HTMLElement, onLeave: (fn: () => void) => void): Promise<void> => {
  const cages = await db.cages.list()
  const allCams = await db.cameras.list()
  const calibs = await db.calibrations.list()
  const settings = await getSettings()
  if (cages.length === 0) {
    root.append(el("div", { class: "notice warn" }, ["请先在「网箱档案」中建立网箱"]))
    return
  }

  let cage: Cage = cages[0]
  let cams: CameraRig[] = allCams.filter((c) => c.cageId === cage.id)
  let fishes: Fish[] = spawnSchool(cage)
  let hour = 10
  let turbidity = 0.3
  let running = true
  let disposed = false
  let raf = 0
  let last = performance.now()
  let simTime = 0

  // 测量状态
  type Pt = { u: number; v: number }
  let measureMode: "off" | "two" | "seg" = "off"
  let measureCam: CameraRig | null = null
  let leftPts: Pt[] = []
  let rightPts: Pt[] = []
  let pendingSave: { lengthM: number; snout3: Vec3; fork3: Vec3 } | null = null

  const renderer = new Renderer()
  await renderer.init()
  renderer.setCage(cage)

  root.append(
    el("h2", { class: "page-title" }, ["双目画面"]),
    el("p", { class: "page-desc" }, ["仿真水下画面,渲染使用真值参数;测量使用「使用参数」(标定结果或标称值+扰动),两者分离。"]),
  )

  // 顶部控制条
  const cageSel = el("select", {}) as HTMLSelectElement
  for (const c of cages) cageSel.append(el("option", { value: c.id }, [c.name]))
  cageSel.value = cage.id
  const hourVal = el("span", { class: "val" }, [`${hour}:00`])
  const turbVal = el("span", { class: "val" }, [turbidity.toFixed(2)])
  const pauseBtn = el("button", { class: "btn", onclick: () => {
    running = !running
    pauseBtn.textContent = running ? "暂停" : "继续"
  } }, ["暂停"])
  const controls = el("div", { class: "card row" }, [
    el("span", { class: "muted" }, ["网箱:"]), cageSel,
    el("span", { class: "muted" }, ["时辰:"]),
    el("input", { type: "range", min: "0", max: "23", value: String(hour), style: "width:140px", oninput: (e: Event) => {
      hour = Number((e.target as HTMLInputElement).value)
      hourVal.textContent = `${hour}:00`
    } }),
    hourVal,
    el("span", { class: "muted" }, ["浑浊度:"]),
    el("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(turbidity), style: "width:140px", oninput: (e: Event) => {
      turbidity = Number((e.target as HTMLInputElement).value)
      turbVal.textContent = turbidity.toFixed(2)
    } }),
    turbVal,
    pauseBtn,
  ])
  root.append(controls)

  // 测量工具条
  const camSel = el("select", {}) as HTMLSelectElement
  const statusLine = el("span", { class: "muted small" }, ["未在测量"])
  const toolbar = el("div", { class: "card row" }, [
    el("span", { class: "muted" }, ["测量相机:"]), camSel,
    el("button", { class: "btn", onclick: () => setMode(measureMode === "two" ? "off" : "two") }, ["两点测量"]),
    el("button", { class: "btn", onclick: () => setMode(measureMode === "seg" ? "off" : "seg") }, ["分段测量(弯鱼)"]),
    el("button", { class: "btn", onclick: () => autoCorrespond() }, ["自动对应"]),
    el("button", { class: "btn", onclick: () => { resetMeasure(); statusLine.textContent = "标点已清除" } }, ["清除标点"]),
    el("button", { class: "btn primary", onclick: () => runAutoMeasure() }, ["自动测量一轮"]),
    statusLine,
  ])
  root.append(toolbar)

  const viewGrid = el("div", { class: "view-grid" })
  root.append(viewGrid)

  let pairs: PairUI[] = []

  const rebuildViews = () => {
    viewGrid.innerHTML = ""
    pairs = []
    camSel.innerHTML = ""
    for (const cam of cams) {
      camSel.append(el("option", { value: cam.id }, [cam.name]))
      const cvL = el("canvas", { class: "gpu" }) as HTMLCanvasElement
      const cvR = el("canvas", { class: "gpu" }) as HTMLCanvasElement
      const ovL = el("canvas", { class: "overlay" }) as HTMLCanvasElement
      const ovR = el("canvas", { class: "overlay" }) as HTMLCanvasElement
      const wrapL = el("div", { class: "view-wrap" }, [cvL, ovL, el("span", { class: "view-label" }, ["左"])])
      const wrapR = el("div", { class: "view-wrap" }, [cvR, ovR, el("span", { class: "view-label" }, ["右"])])
      const calibTag = cam.calibrated ? "已标定" : "未标定(标称参数)"
      viewGrid.append(el("div", { class: "stereo-pair" }, [
        el("div", { class: "pair-title" }, [
          el("span", {}, [`${cam.name} · 基线 ${(cam.baseline * 1000).toFixed(0)}mm · 深 ${cam.installDepth}m`]),
          el("span", {}, [calibTag]),
        ]),
        el("div", { class: "pair-views" }, [wrapL, wrapR]),
      ]))
      const pair: PairUI = { cam, viewL: renderer.createView(cvL), viewR: renderer.createView(cvR), overlayL: ovL, overlayR: ovR }
      pairs.push(pair)
      ovL.addEventListener("click", (e) => onViewClick(pair, "L", e))
      ovR.addEventListener("click", (e) => onViewClick(pair, "R", e))
    }
    if (cams.length > 0) {
      measureCam = cams[0]
      camSel.onchange = () => {
        measureCam = cams.find((c) => c.id === camSel.value) ?? null
        resetMeasure()
      }
    }
  }

  const setMode = (m: "off" | "two" | "seg") => {
    measureMode = m
    resetMeasure()
    if (m !== "off") {
      running = false
      pauseBtn.textContent = "继续"
      statusLine.textContent = m === "two" ? "两点测量:左图点吻端 → 右图对应点 → 左图尾叉 → 右图对应点" : "分段测量:左图沿中轴逐点单击,每点一下按一次「自动对应」(或右图手点),点满自动出结果"
    } else {
      statusLine.textContent = "未在测量"
    }
  }

  const resetMeasure = () => {
    leftPts = []
    rightPts = []
    pendingSave = null
    drawOverlays()
  }

  // 传感器坐标 -> overlay 显示坐标
  const toDisp = (cv: HTMLCanvasElement, u: number, v: number): [number, number] => [
    (u / IMG_W) * cv.width, (v / IMG_H) * cv.height,
  ]

  const fitOverlay = (cv: HTMLCanvasElement) => {
    const w = cv.clientWidth || VIEW_W
    const h = cv.clientHeight || VIEW_H
    if (cv.width !== Math.round(w) || cv.height !== Math.round(h)) {
      cv.width = Math.round(w)
      cv.height = Math.round(h)
    }
  }

  const drawOverlays = () => {
    for (const p of pairs) {
      for (const [ov, pts, line] of [
        [p.overlayL, leftPts, null],
        [p.overlayR, rightPts, pendingLine(p.cam)],
      ] as [HTMLCanvasElement, Pt[], [number, number, number] | null][]) {
        fitOverlay(ov)
        const ctx = ov.getContext("2d")!
        ctx.clearRect(0, 0, ov.width, ov.height)
        if (line && measureCam?.id === p.cam.id && leftPts.length > rightPts.length) {
          // 画极线
          ctx.strokeStyle = "#22d3ee"
          ctx.lineWidth = 1.5
          ctx.beginPath()
          const [a, b, c] = line
          const pts2: [number, number][] = []
          if (Math.abs(b) > 1e-6) {
            pts2.push([0, -c / b], [IMG_W, (-a * IMG_W - c) / b])
          } else {
            pts2.push([-c / a, 0], [-c / a, IMG_H])
          }
          const [x1, y1] = toDisp(ov, pts2[0][0], pts2[0][1])
          const [x2, y2] = toDisp(ov, pts2[1][0], pts2[1][1])
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
        }
        pts.forEach((pt, i) => {
          const [x, y] = toDisp(ov, pt.u, pt.v)
          ctx.fillStyle = i === 0 ? "#f59e0b" : "#22d3ee"
          ctx.beginPath()
          ctx.arc(x, y, 4, 0, Math.PI * 2)
          ctx.fill()
        })
      }
    }
  }

  // 当前待匹配的极线(左图最新点 -> 右图)
  const pendingLine = (cam: CameraRig): [number, number, number] | null => {
    if (leftPts.length <= rightPts.length || leftPts.length === 0) return null
    const pt = leftPts[leftPts.length - 1]
    const used = effectiveParams(cam, settings)
    const poses = usedRigPoses(cam, cage, settings, calibs.find((k) => k.cameraId === cam.id) ?? null)
    return epipolarLine(pt.u, pt.v, poses.left, used, poses.right, used)
  }

  const onViewClick = async (pair: PairUI, side: "L" | "R", e: MouseEvent) => {
    if (measureMode === "off" || !measureCam || pair.cam.id !== measureCam.id) return
    const ov = side === "L" ? pair.overlayL : pair.overlayR
    const rect = ov.getBoundingClientRect()
    const u = ((e.clientX - rect.left) / rect.width) * IMG_W
    const v = ((e.clientY - rect.top) / rect.height) * IMG_H
    if (side === "L") {
      if (measureMode === "two" && leftPts.length >= 2) { toast("两点测量已完成,请保存或重开", "warn"); return }
      leftPts.push({ u, v })
    } else {
      rightPts.push({ u, v })
    }
    drawOverlays()
    await maybeFinish(pair)
  }

  const maybeFinish = async (pair: PairUI) => {
    if (!measureCam) return
    const cam = measureCam
    const used = effectiveParams(cam, settings)
    const calib = calibs.find((k) => k.cameraId === cam.id) ?? null
    const poses = usedRigPoses(cam, cage, settings, calib)
    if (measureMode === "two" && leftPts.length === 2 && rightPts.length === 2) {
      const s3 = triangulatePoint(leftPts[0].u, leftPts[0].v, rightPts[0].u, rightPts[0].v, poses.left, used, poses.right, used)
      const f3 = triangulatePoint(leftPts[1].u, leftPts[1].v, rightPts[1].u, rightPts[1].v, poses.left, used, poses.right, used)
      const lenM = stereoLength(
        leftPts[0].u, leftPts[0].v, rightPts[0].u, rightPts[0].v,
        leftPts[1].u, leftPts[1].v, rightPts[1].u, rightPts[1].v,
        poses.left, used, poses.right, used,
      )
      pendingSave = { lengthM: lenM, snout3: s3, fork3: f3 }
      statusLine.textContent = `叉长 ${(pendingSave.lengthM * 100).toFixed(1)} cm — 点击「保存记录」入库`
      showSaveButton(pair)
    } else if (measureMode === "seg" && leftPts.length >= 2 && rightPts.length === leftPts.length) {
      const lenM = measureSegmented(
        leftPts.map((p) => [p.u, p.v] as [number, number]),
        rightPts.map((p) => [p.u, p.v] as [number, number]),
        poses.left, used, poses.right, used,
      )
      const s3 = triangulatePoint(leftPts[0].u, leftPts[0].v, rightPts[0].u, rightPts[0].v, poses.left, used, poses.right, used)
      const lastL = leftPts[leftPts.length - 1]
      const lastR = rightPts[rightPts.length - 1]
      const f3 = triangulatePoint(lastL.u, lastL.v, lastR.u, lastR.v, poses.left, used, poses.right, used)
      pendingSave = { lengthM: lenM, snout3: s3, fork3: f3 }
      statusLine.textContent = `分段叉长 ${(lenM * 100).toFixed(1)} cm — 点击「保存记录」入库`
      showSaveButton(pair)
    }
  }

  const showSaveButton = (pair: PairUI) => {
    if (toolbar.querySelector("#save-measure")) return
    toolbar.append(el("button", { id: "save-measure", class: "btn primary", onclick: async () => {
      if (!pendingSave || !measureCam) return
      // 仿真对账:找真实脊柱两端最近的鱼
      let bestFish: Fish | null = null
      let bestD = 0.2
      for (const f of fishes) {
        const d = v3.dist(fishSpinePoint(f, 0, simTime), pendingSave.snout3) +
          v3.dist(fishSpinePoint(f, 1, simTime), pendingSave.fork3)
        if (d < bestD) { bestD = d; bestFish = f }
      }
      const lenCm = pendingSave.lengthM * 100
      const a = settings.lwA[settings.season]
      const b = settings.lwB[settings.season]
      const m: Measurement = {
        id: uid(), cageId: cage.id, cameraId: measureCam.id, date: Date.now(),
        type: "manual", forkLength: lenCm, weight: a * Math.pow(lenCm, b),
        confidence: 0.85, fishId: bestFish?.id ?? null,
        trueLength: bestFish ? bestFish.forkLen * 100 : null, createdAt: Date.now(),
      }
      await db.measurements.put(m)
      toast(`已保存:叉长 ${lenCm.toFixed(1)} cm${m.trueLength ? `(真值 ${m.trueLength.toFixed(1)} cm)` : "(未匹配到仿真鱼)"}`)
      toolbar.querySelector("#save-measure")?.remove()
      resetMeasure()
      statusLine.textContent = "已保存,可继续测量"
    } }, ["保存记录"]))
  }

  // NCC 自动对应:为左图最新点在右图找匹配
  const autoCorrespond = async () => {
    if (!measureCam || leftPts.length <= rightPts.length) { toast("先在左图点一个点", "warn"); return }
    const pair = pairs.find((p) => p.cam.id === measureCam!.id)
    if (!pair) return
    const line = pendingLine(measureCam)
    if (!line) return
    const [imgL, imgR] = await Promise.all([pair.viewL.readPixels(), pair.viewR.readPixels()])
    const pt = leftPts[leftPts.length - 1]
    const m = nccMatch(imgL, imgR, VIEW_W, VIEW_H, pt.u, pt.v, line)
    if (m.score < 0.55) { toast(`自动对应失败(匹配度 ${m.score.toFixed(2)}),请手动点右图`, "warn"); return }
    rightPts.push({ u: m.u, v: m.v })
    drawOverlays()
    await maybeFinish(pair)
    toast(`自动对应成功(匹配度 ${m.score.toFixed(2)})`)
  }

  const runAutoMeasure = async () => {
    let total = 0
    let skipped = 0
    for (const cam of cams) {
      const calib = calibs.find((k) => k.cameraId === cam.id) ?? null
      const r = autoMeasure(fishes, cam, cage, settings, calib, simTime)
      for (const m of r.measured) await db.measurements.put(m)
      total += r.measured.length
      skipped += r.skipped
    }
    toast(`自动测量完成:测得 ${total} 条,跳过 ${skipped} 条(姿态/遮挡/出画)`)
  }

  // 网箱切换
  cageSel.onchange = () => {
    cage = cages.find((c) => c.id === cageSel.value) ?? cages[0]
    cams = allCams.filter((c) => c.cageId === cage.id)
    fishes = spawnSchool(cage)
    renderer.setCage(cage)
    resetMeasure()
    rebuildViews()
  }

  rebuildViews()

  // 渲染循环
  const loop = () => {
    if (disposed) return
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (running) {
      simTime += dt
      updateSchool(fishes, cage, cams, dt, simTime)
    }
    const env = computeEnvironment(hour, turbidity, cage.netDepth / 2)
    renderer.updateEnv(env)
    renderer.updateFish(fishes)
    for (const p of pairs) {
      const poses = trueRigPoses(p.cam, cage)
      renderer.renderView(p.viewL, poses.left, SIM_TRUTH, fishes.length, env)
      renderer.renderView(p.viewR, poses.right, SIM_TRUTH, fishes.length, env)
    }
    raf = requestAnimationFrame(loop)
  }
  loop()

  onLeave(() => {
    disposed = true
    cancelAnimationFrame(raf)
  })
}
