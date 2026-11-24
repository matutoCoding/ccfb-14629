// WebGPU 渲染器:鱼群实例化 + 网衣 + 海底,逐视图折射投影 + 畸变后处理
import { CamParams, CamPose, IMG_W, IMG_H, worldToCam } from "../core/camera"
import { Mat3 } from "../core/math"
import { Environment } from "../sim/scene"
import { Fish } from "../sim/fish"
import { Cage } from "../db/db"
import { buildFishMesh, buildNetMesh, buildSeabed, Mesh, LineMesh } from "./mesh"

const FISH_WGSL = `
struct Cam { view: mat4x4<f32>, p1: vec4<f32>, p2: vec4<f32> }
struct Env { fog: vec4<f32>, light: vec4<f32>, misc: vec4<f32> }
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<uniform> env: Env;

fn project(p_in: vec3<f32>) -> vec4<f32> {
  var p = p_in;
  let port = cam.p2.x;
  let n2 = cam.p2.y;
  if (p.z > 0.0 && n2 > 1.0001) {
    let rho = length(p.xy);
    if (rho > 1e-6) {
      let u2 = p.xy / rho;
      if (port < 1e-6) {
        // 界面在光心:角度映射 θ1 = asin(n2·sinθ2)
        let sinT2 = rho / sqrt(rho * rho + p.z * p.z);
        let s1 = n2 * sinT2;
        if (s1 < 1.0) {
          let tanT1 = s1 / sqrt(1.0 - s1 * s1);
          p = vec3<f32>(tanT1 * u2, 1.0);
        }
      } else if (p.z > port) {
        // 二分求玻璃面折射点 q:n2·sinθ2 = sinθ1
        var lo = 0.0;
        var hi = rho;
        for (var i = 0; i < 24; i = i + 1) {
          let q = 0.5 * (lo + hi);
          let s1 = q / sqrt(q * q + port * port);
          let dz = p.z - port;
          let dr = rho - q;
          let s2 = dr / sqrt(dr * dr + dz * dz);
          if (n2 * s2 > s1) { lo = q; } else { hi = q; }
        }
        let q = 0.5 * (lo + hi);
        p = vec3<f32>(q * u2, port);
      }
    }
  }
  let u = cam.p1.x * (p.x / p.z) + cam.p1.z;
  let v = cam.p1.y * (p.y / p.z) + cam.p1.w;
  let nx = u / cam.p2.z * 2.0 - 1.0;
  let ny = 1.0 - v / cam.p2.w * 2.0;
  let nz = clamp((p.z - 0.3) / 29.7, 0.0, 1.0);
  return vec4<f32>(nx, ny, nz, 1.0);
}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) col: vec3<f32>,
  @location(1) dist: f32,
}

@vertex fn vsFish(
  @location(0) pos: vec3<f32>, @location(1) nrm: vec3<f32>, @location(2) col: vec3<f32>,
  @location(3) i0: vec4<f32>, @location(4) i1: vec4<f32>,
) -> VOut {
  let heading = i0.w;
  let scl = i1.x;
  let phase = i1.y;
  let amp = i1.z;
  let tint = i1.w;
  var bp = pos;
  bp.z += amp * bp.x * sin(phase - bp.x * 6.0);
  let c = cos(heading); let s = sin(heading);
  let wp = vec3<f32>(c * bp.x + s * bp.z, bp.y, -s * bp.x + c * bp.z) * scl + i0.xyz;
  let wn = vec3<f32>(c * nrm.x + s * nrm.z, nrm.y, -s * nrm.x + c * nrm.z);
  let pc = (cam.view * vec4<f32>(wp, 1.0)).xyz;
  var out: VOut;
  out.pos = project(pc);
  let diff = max(dot(wn, -env.light.xyz), 0.0) * env.misc.x;
  let shade = env.light.w + diff;
  out.col = col * (0.85 + tint * 0.3) * shade;
  out.dist = pc.z;
  return out;
}

@vertex fn vsStatic(@location(0) pos: vec3<f32>, @location(1) col: vec3<f32>) -> VOut {
  let pc = (cam.view * vec4<f32>(pos, 1.0)).xyz;
  var out: VOut;
  out.pos = project(pc);
  out.col = col * (env.light.w + 0.15);
  out.dist = pc.z;
  return out;
}

@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let f = 1.0 - exp(-in.dist * env.fog.w);
  return vec4<f32>(mix(in.col, env.fog.rgb, f), 1.0);
}
`

const WARP_WGSL = `
struct Warp { p1: vec4<f32>, p2: vec4<f32>, fog: vec4<f32> }
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> warp: Warp;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vi], 0.0, 1.0);
}

@fragment fn fs(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let xd = (fc.x - warp.p1.z) / warp.p1.x;
  let yd = (fc.y - warp.p1.w) / warp.p1.y;
  var x = xd; var y = yd;
  for (var i = 0; i < 8; i = i + 1) {
    let r2 = x * x + y * y;
    let s = 1.0 + warp.p2.x * r2 + warp.p2.y * r2 * r2;
    x = xd / s; y = yd / s;
  }
  let uv = vec2<f32>((warp.p1.x * x + warp.p1.z) / warp.p2.z, (warp.p1.y * y + warp.p1.w) / warp.p2.w);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4<f32>(warp.fog.rgb, 1.0);
  }
  return textureSample(srcTex, samp, uv);
}
`

const BLIT_WGSL = `
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vi], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fc.xy / vec2<f32>(textureDimensions(srcTex));
  return textureSample(srcTex, samp, uv);
}
`

export const VIEW_W = 640
export const VIEW_H = 360
const MAX_FISH = 64

// 视图矩阵(世界->相机)列主序
const viewMatrix = (pose: CamPose): Float32Array => {
  const R = pose.rot
  const rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]] // R^T 行主序
  const t = [
    -(rt[0] * pose.pos[0] + rt[1] * pose.pos[1] + rt[2] * pose.pos[2]),
    -(rt[3] * pose.pos[0] + rt[4] * pose.pos[1] + rt[5] * pose.pos[2]),
    -(rt[6] * pose.pos[0] + rt[7] * pose.pos[1] + rt[8] * pose.pos[2]),
  ]
  return new Float32Array([
    rt[0], rt[3], rt[6], 0,
    rt[1], rt[4], rt[7], 0,
    rt[2], rt[5], rt[8], 0,
    t[0], t[1], t[2], 1,
  ])
}

export class View {
  canvas: HTMLCanvasElement
  ctx: GPUCanvasContext
  sceneTex!: GPUTexture
  depthTex!: GPUTexture
  displayTex!: GPUTexture
  camBuf: GPUBuffer
  warpBuf: GPUBuffer
  sceneBind!: GPUBindGroup
  warpBind!: GPUBindGroup
  blitBind!: GPUBindGroup

  constructor(private gpu: Renderer, canvas: HTMLCanvasElement) {
    this.canvas = canvas
    canvas.width = VIEW_W
    canvas.height = VIEW_H
    this.ctx = canvas.getContext("webgpu") as GPUCanvasContext
    this.ctx.configure({
      device: gpu.device,
      format: gpu.format,
      alphaMode: "opaque",
    })
    this.camBuf = gpu.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.warpBuf = gpu.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.buildTextures()
  }

  buildTextures(): void {
    const { device } = this.gpu
    this.sceneTex?.destroy()
    this.depthTex?.destroy()
    this.displayTex?.destroy()
    this.sceneTex = device.createTexture({
      size: [VIEW_W, VIEW_H], format: this.gpu.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.depthTex = device.createTexture({
      size: [VIEW_W, VIEW_H], format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.displayTex = device.createTexture({
      size: [VIEW_W, VIEW_H], format: this.gpu.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    })
    this.sceneBind = device.createBindGroup({
      layout: this.gpu.sceneBindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.camBuf } },
        { binding: 1, resource: { buffer: this.gpu.envBuf } },
      ],
    })
    this.warpBind = device.createBindGroup({
      layout: this.gpu.warpBindLayout,
      entries: [
        { binding: 0, resource: this.sceneTex.createView() },
        { binding: 1, resource: this.gpu.sampler },
        { binding: 2, resource: { buffer: this.warpBuf } },
      ],
    })
    this.blitBind = device.createBindGroup({
      layout: this.gpu.blitBindLayout,
      entries: [
        { binding: 0, resource: this.displayTex.createView() },
        { binding: 1, resource: this.gpu.sampler },
      ],
    })
  }

  // 读出显示图像(传感器坐标系 = 1280x720 的 0.5 倍)
  async readPixels(): Promise<Uint8Array> {
    const { device } = this.gpu
    const bpr = Math.ceil((VIEW_W * 4) / 256) * 256
    const buf = device.createBuffer({ size: bpr * VIEW_H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const enc = device.createCommandEncoder()
    enc.copyTextureToBuffer({ texture: this.displayTex }, { buffer: buf, bytesPerRow: bpr }, [VIEW_W, VIEW_H])
    device.queue.submit([enc.finish()])
    await buf.mapAsync(GPUMapMode.READ)
    const src = new Uint8Array(buf.getMappedRange())
    const out = new Uint8Array(VIEW_W * VIEW_H * 4)
    for (let y = 0; y < VIEW_H; y++) out.set(src.subarray(y * bpr, y * bpr + VIEW_W * 4), y * VIEW_W * 4)
    buf.unmap()
    buf.destroy()
    return out
  }
}

export class Renderer {
  device!: GPUDevice
  format: GPUTextureFormat = "bgra8unorm"
  envBuf!: GPUBuffer
  sampler!: GPUSampler
  sceneBindLayout!: GPUBindGroupLayout
  warpBindLayout!: GPUBindGroupLayout
  blitBindLayout!: GPUBindGroupLayout
  private fishPipeline!: GPURenderPipeline
  private linePipeline!: GPURenderPipeline
  private triPipeline!: GPURenderPipeline
  private warpPipeline!: GPURenderPipeline
  private blitPipeline!: GPURenderPipeline
  private fishVB!: GPUBuffer
  private fishIB!: GPUBuffer
  private fishIndexCount = 0
  private instBuf!: GPUBuffer
  private netVB: GPUBuffer | null = null
  private netIB: GPUBuffer | null = null
  private netIndexCount = 0
  private seabedVB!: GPUBuffer
  private seabedIB!: GPUBuffer
  private seabedIndexCount = 0

  async init(): Promise<void> {
    if (!navigator.gpu) throw new Error("此浏览器不支持 WebGPU,请使用最新版 Chrome / Edge")
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) throw new Error("未找到可用的 GPU 适配器")
    this.device = await adapter.requestDevice()
    this.format = navigator.gpu.getPreferredCanvasFormat()

    this.envBuf = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" })

    this.sceneBindLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      ],
    })
    this.warpBindLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
      ],
    })
    this.blitBindLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    })

    const fishMod = this.device.createShaderModule({ code: FISH_WGSL })
    const sceneLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.sceneBindLayout] })
    const meshLayout: GPUVertexBufferLayout = {
      arrayStride: 36,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x3" },
      ],
    }
    const instLayout: GPUVertexBufferLayout = {
      arrayStride: 32,
      stepMode: "instance",
      attributes: [
        { shaderLocation: 3, offset: 0, format: "float32x4" },
        { shaderLocation: 4, offset: 16, format: "float32x4" },
      ],
    }
    const target: GPUColorTargetState = { format: this.format }
    const depth: GPUDepthStencilState = { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
    this.fishPipeline = this.device.createRenderPipeline({
      layout: sceneLayout,
      vertex: { module: fishMod, entryPoint: "vsFish", buffers: [meshLayout, instLayout] },
      fragment: { module: fishMod, entryPoint: "fs", targets: [target] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: depth,
    })
    const lineMeshLayout: GPUVertexBufferLayout = {
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
      ],
    }
    this.linePipeline = this.device.createRenderPipeline({
      layout: sceneLayout,
      vertex: { module: fishMod, entryPoint: "vsStatic", buffers: [lineMeshLayout] },
      fragment: { module: fishMod, entryPoint: "fs", targets: [target] },
      primitive: { topology: "line-list" },
      depthStencil: depth,
    })
    this.triPipeline = this.device.createRenderPipeline({
      layout: sceneLayout,
      vertex: { module: fishMod, entryPoint: "vsStatic", buffers: [lineMeshLayout] },
      fragment: { module: fishMod, entryPoint: "fs", targets: [target] },
      primitive: { topology: "triangle-list" },
      depthStencil: depth,
    })
    const warpMod = this.device.createShaderModule({ code: WARP_WGSL })
    this.warpPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.warpBindLayout] }),
      vertex: { module: warpMod, entryPoint: "vs" },
      fragment: { module: warpMod, entryPoint: "fs", targets: [target] },
      primitive: { topology: "triangle-list" },
    })
    const blitMod = this.device.createShaderModule({ code: BLIT_WGSL })
    this.blitPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.blitBindLayout] }),
      vertex: { module: blitMod, entryPoint: "vs" },
      fragment: { module: blitMod, entryPoint: "fs", targets: [target] },
      primitive: { topology: "triangle-list" },
    })

    const fish = buildFishMesh()
    this.fishIndexCount = fish.indices.length
    this.fishVB = this.makeBuf(fish.vertices, GPUBufferUsage.VERTEX)
    this.fishIB = this.makeBuf(fish.indices, GPUBufferUsage.INDEX)
    this.instBuf = this.device.createBuffer({ size: MAX_FISH * 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
  }

  private makeBuf(data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags): GPUBuffer {
    const buf = this.device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST })
    this.device.queue.writeBuffer(buf, 0, data as GPUAllowSharedBufferSource)
    return buf
  }

  setCage(cage: Cage): void {
    const net = buildNetMesh(cage.circumference, cage.netDepth)
    this.netIndexCount = net.indices.length
    this.netVB = this.makeBuf(net.vertices, GPUBufferUsage.VERTEX)
    this.netIB = this.makeBuf(net.indices, GPUBufferUsage.INDEX)
    const seabed = buildSeabed(-cage.netDepth - 2, cage.circumference * 4)
    this.seabedIndexCount = seabed.indices.length
    // 海底用 Mesh 布局(pos+nrm+col),静态管线只读 pos/col,需重排
    const packed = new Float32Array((seabed.vertices.length / 9) * 6)
    for (let i = 0; i < seabed.vertices.length / 9; i++) {
      packed[i * 6] = seabed.vertices[i * 9]
      packed[i * 6 + 1] = seabed.vertices[i * 9 + 1]
      packed[i * 6 + 2] = seabed.vertices[i * 9 + 2]
      packed[i * 6 + 3] = seabed.vertices[i * 9 + 6]
      packed[i * 6 + 4] = seabed.vertices[i * 9 + 7]
      packed[i * 6 + 5] = seabed.vertices[i * 9 + 8]
    }
    this.seabedVB = this.makeBuf(packed, GPUBufferUsage.VERTEX)
    this.seabedIB = this.makeBuf(seabed.indices, GPUBufferUsage.INDEX)
  }

  createView(canvas: HTMLCanvasElement): View {
    return new View(this, canvas)
  }

  updateEnv(env: Environment): void {
    this.device.queue.writeBuffer(this.envBuf, 0, new Float32Array([
      ...env.fogColor, env.fogDensity,
      ...env.lightDir, env.ambient,
      env.sunIntensity, 0, 0, 0,
    ]))
  }

  updateFish(fishes: Fish[]): void {
    const n = Math.min(fishes.length, MAX_FISH)
    const data = new Float32Array(n * 8)
    for (let i = 0; i < n; i++) {
      const f = fishes[i]
      data.set([f.pos[0], f.pos[1], f.pos[2], f.heading, f.forkLen, f.phase, f.amp, f.tint], i * 8)
    }
    this.device.queue.writeBuffer(this.instBuf, 0, data)
  }

  renderView(view: View, pose: CamPose, params: CamParams, fishCount: number, env: Environment): void {
    const s = VIEW_W / IMG_W
    const cam = new Float32Array(24)
    cam.set(viewMatrix(pose), 0)
    cam.set([params.fx * s, params.fy * s, params.cx * s, params.cy * s], 16)
    cam.set([params.portDist, params.nWater, VIEW_W, VIEW_H], 20)
    this.device.queue.writeBuffer(view.camBuf, 0, cam)
    this.device.queue.writeBuffer(view.warpBuf, 0, new Float32Array([
      params.fx * s, params.fy * s, params.cx * s, params.cy * s,
      params.k1, params.k2, VIEW_W, VIEW_H,
      ...env.fogColor, 1,
    ]))

    const enc = this.device.createCommandEncoder()
    // 场景 pass
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: view.sceneTex.createView(),
        clearValue: { r: env.fogColor[0], g: env.fogColor[1], b: env.fogColor[2], a: 1 },
        loadOp: "clear", storeOp: "store",
      }],
      depthStencilAttachment: {
        view: view.depthTex.createView(),
        depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store",
      },
    })
    pass.setBindGroup(0, view.sceneBind)
    if (this.seabedVB) {
      pass.setPipeline(this.triPipeline)
      pass.setVertexBuffer(0, this.seabedVB)
      pass.setIndexBuffer(this.seabedIB!, "uint32")
      pass.drawIndexed(this.seabedIndexCount)
    }
    if (this.netVB) {
      pass.setPipeline(this.linePipeline)
      pass.setVertexBuffer(0, this.netVB)
      pass.setIndexBuffer(this.netIB!, "uint32")
      pass.drawIndexed(this.netIndexCount)
    }
    if (fishCount > 0) {
      pass.setPipeline(this.fishPipeline)
      pass.setVertexBuffer(0, this.fishVB)
      pass.setVertexBuffer(1, this.instBuf)
      pass.setIndexBuffer(this.fishIB, "uint32")
      pass.drawIndexed(this.fishIndexCount, Math.min(fishCount, MAX_FISH))
    }
    pass.end()
    // 畸变 warp -> displayTex
    const wp = enc.beginRenderPass({
      colorAttachments: [{ view: view.displayTex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    })
    wp.setPipeline(this.warpPipeline)
    wp.setBindGroup(0, view.warpBind)
    wp.draw(3)
    wp.end()
    // blit -> canvas
    const bp = enc.beginRenderPass({
      colorAttachments: [{ view: view.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    })
    bp.setPipeline(this.blitPipeline)
    bp.setBindGroup(0, view.blitBind)
    bp.draw(3)
    bp.end()
    this.device.queue.submit([enc.finish()])
  }
}

export { worldToCam, IMG_W, IMG_H }
export type { Mesh, LineMesh }
