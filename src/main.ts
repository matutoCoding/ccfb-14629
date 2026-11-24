// 入口:导航 + 路由
import { seedIfEmpty } from "./db/db"
import { el, icons } from "./ui/ui"
import { cagesPage } from "./pages/cages"
import { calibrationPage } from "./pages/calibration"
import { stereoPage } from "./pages/stereo"
import { recordsPage } from "./pages/records"
import { growthPage } from "./pages/growth"
import { settingsPage } from "./pages/settings"

type PageFn = (root: HTMLElement, onLeave: (fn: () => void) => void) => Promise<void>

const routes: { path: string; label: string; icon: () => SVGSVGElement; page: PageFn }[] = [
  { path: "cages", label: "网箱档案", icon: icons.cage, page: (r, o) => cagesPage(r) },
  { path: "calibration", label: "相机标定", icon: icons.calib, page: (r, o) => calibrationPage(r) },
  { path: "stereo", label: "双目画面", icon: icons.stereo, page: stereoPage },
  { path: "records", label: "测量记录", icon: icons.records, page: (r, o) => recordsPage(r) },
  { path: "growth", label: "生长分析", icon: icons.growth, page: (r, o) => growthPage(r) },
  { path: "settings", label: "设置", icon: icons.settings, page: (r, o) => settingsPage(r) },
]

let leaveFns: (() => void)[] = []

const navigate = async () => {
  for (const fn of leaveFns) fn()
  leaveFns = []
  const hash = location.hash.replace("#/", "") || "stereo"
  const route = routes.find((r) => r.path === hash) ?? routes[2]
  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#/${route.path}`)
  })
  const main = document.querySelector(".main") as HTMLElement
  main.innerHTML = ""
  try {
    await route.page(main, (fn) => leaveFns.push(fn))
  } catch (err) {
    main.append(el("div", { class: "notice error" }, [`页面加载失败:${(err as Error).message}`]))
  }
}

const bootstrap = async () => {
  await seedIfEmpty()
  const rootEl = document.getElementById("root")!
  const nav = el("nav", { class: "nav" }, [
    el("div", { class: "nav-brand" }, ["双目测鱼", el("small", {}, ["大黄鱼深水网箱 · 仿真"])]),
    ...routes.map((r) =>
      el("a", { href: `#/${r.path}` }, [r.icon(), r.label]),
    ),
  ])
  rootEl.append(nav, el("div", { class: "main" }))
  window.addEventListener("hashchange", navigate)
  await navigate()
}

bootstrap()
