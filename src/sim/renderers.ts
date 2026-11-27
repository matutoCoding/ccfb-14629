import type { BatchBuilder } from './batch';
import type { WaterState } from './world';

let devicePromise: Promise<GPUDevice | null> | null = null;

export function getGpuDevice(): Promise<GPUDevice | null> {
  if (devicePromise) return devicePromise;
  devicePromise = (async () => {
    if (!('gpu' in navigator)) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      return await adapter.requestDevice();
    } catch (err) {
      console.warn('WebGPU device unavailable, using Canvas2D fallback', err);
      return null;
    }
  })();
  return devicePromise;
}

const SHADER = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  light: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs(@location(0) pixelPos: vec2f, @location(1) color: vec4f) -> VSOut {
  var out: VSOut;
  let x = pixelPos.x / u.resolution.x * 2.0 - 1.0;
  let y = 1.0 - pixelPos.y / u.resolution.y * 2.0;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return in.color;
}
`;

function clearCss(water: WaterState): [number, number, number, number] {
  return [water.color[0] * 0.72, water.color[1] * 0.82, water.color[2] * 0.86, 1];
}

export class WebGpuStage {
  readonly kind = 'webgpu';
  private constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private format: GPUTextureFormat,
    private triPipeline: GPURenderPipeline,
    private linePipeline: GPURenderPipeline,
    private uniformBuffer: GPUBuffer,
    private bindGroup: GPUBindGroup,
    private triBuffer: GPUBuffer | null,
    private lineBuffer: GPUBuffer | null,
    private triCapacity = 0,
    private lineCapacity = 0,
  ) {}

  static async create(canvas: HTMLCanvasElement): Promise<WebGpuStage | null> {
    const device = await getGpuDevice();
    if (!device) return null;
    try {
      const context = canvas.getContext('webgpu');
      if (!context) return null;
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'opaque' });
      const module = device.createShaderModule({ code: SHADER });
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        }],
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const vertexBufferLayout: GPUVertexBufferLayout = {
        arrayStride: 24,
        stepMode: 'vertex',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32x4' },
        ],
      };
      const blend: GPUBlendState = {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
      const makePipeline = (topology: GPUPrimitiveTopology) =>
        device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module, entryPoint: 'vs', buffers: [vertexBufferLayout] },
          fragment: { module, entryPoint: 'fs', targets: [{ format, blend }] },
          primitive: { topology },
        });
      const triPipeline = makePipeline('triangle-list');
      const linePipeline = makePipeline('line-list');
      const uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      return new WebGpuStage(device, context, format, triPipeline, linePipeline, uniformBuffer, bindGroup, null, null);
    } catch (err) {
      console.warn('WebGPU stage init failed', err);
      return null;
    }
  }

  private ensureBuffer(current: GPUBuffer | null, capacityFloats: number, neededFloats: number): { buffer: GPUBuffer; capacity: number } {
    if (current && capacityFloats >= neededFloats) return { buffer: current, capacity: capacityFloats };
    current?.destroy();
    const capacity = Math.max(256, Math.ceil(neededFloats * 1.35));
    const buffer = this.device.createBuffer({ size: capacity * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    return { buffer, capacity };
  }

  render(batch: BatchBuilder, width: number, height: number, water: WaterState, _scale = 1) {
    const clear = clearCss(water);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([width, height, 0, water.light]));
    const tri = this.ensureBuffer(this.triBuffer, this.triCapacity, batch.triangles.length);
    this.triBuffer = tri.buffer; this.triCapacity = tri.capacity;
    if (batch.triangles.length) this.device.queue.writeBuffer(this.triBuffer, 0, new Float32Array(batch.triangles));
    const line = this.ensureBuffer(this.lineBuffer, this.lineCapacity, batch.lines.length);
    this.lineBuffer = line.buffer; this.lineCapacity = line.capacity;
    if (batch.lines.length) this.device.queue.writeBuffer(this.lineBuffer, 0, new Float32Array(batch.lines));

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: clear[0], g: clear[1], b: clear[2], a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (batch.triangles.length) {
      pass.setPipeline(this.triPipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.triBuffer);
      pass.draw(batch.triangles.length / 6);
    }
    if (batch.lines.length) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.lineBuffer);
      pass.draw(batch.lines.length / 6);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}

export class Canvas2DStage {
  readonly kind = 'canvas2d';
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D unavailable');
    this.ctx = ctx;
  }
  render(batch: BatchBuilder, width: number, height: number, water: WaterState, scale = 1) {
    const ctx = this.ctx;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const c = clearCss(water);
    ctx.fillStyle = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
    ctx.fillRect(0, 0, width, height);
    const drawVertices = (data: number[], mode: 'triangles' | 'lines') => {
      if (!data.length) return;
      ctx.lineWidth = 1;
      if (mode === 'triangles') {
        for (let i = 0; i + 17 < data.length; i += 18) {
          ctx.beginPath();
          ctx.moveTo(data[i], data[i + 1]);
          ctx.lineTo(data[i + 6], data[i + 7]);
          ctx.lineTo(data[i + 12], data[i + 13]);
          ctx.closePath();
          ctx.fillStyle = rgba(data, i + 2);
          ctx.fill();
        }
      } else {
        for (let i = 0; i + 11 < data.length; i += 12) {
          ctx.beginPath();
          ctx.moveTo(data[i], data[i + 1]);
          ctx.lineTo(data[i + 6], data[i + 7]);
          ctx.strokeStyle = rgba(data, i + 2);
          ctx.stroke();
        }
      }
    };
    drawVertices(batch.triangles, 'triangles');
    drawVertices(batch.lines, 'lines');
    // Turbidity / depth wash.
    const grad = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, width * 0.72);
    grad.addColorStop(0, 'rgba(120,190,180,0.03)');
    grad.addColorStop(1, `rgba(5,35,42,${0.22 + water.turbidity * 0.22})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }
}

function rgba(d: number[], o: number): string {
  return `rgba(${Math.round(d[o] * 255)},${Math.round(d[o + 1] * 255)},${Math.round(d[o + 2] * 255)},${d[o + 3]})`;
}

export type AnyStage = WebGpuStage | Canvas2DStage;
