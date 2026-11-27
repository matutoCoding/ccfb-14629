import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CameraModel } from '../lib/camera';
import type { FishWorld } from '../sim/world';
import { buildCameraBatch } from '../sim/batch';
import { Canvas2DStage, WebGpuStage, type AnyStage } from '../sim/renderers';

interface Props {
  world: FishWorld | null;
  camera: CameraModel | null;
  className?: string;
  children?: ReactNode;
  onCanvas?: (canvas: HTMLCanvasElement | null) => void;
  paused?: boolean;
  preferWebGpu?: boolean;
  lowResolution?: boolean;
}

export function CameraCanvas({ world, camera, className, children, onCanvas, paused, preferWebGpu = true, lowResolution = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<AnyStage | null>(null);
  const [backend, setBackend] = useState<'webgpu' | 'canvas2d' | 'init'>('init');
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const fpsWindowStartRef = useRef(performance.now());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const renderScale = lowResolution ? 0.67 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !camera) return;
    let cancelled = false;
    canvas.width = Math.round(camera.width * renderScale);
    canvas.height = Math.round(camera.height * renderScale);
    onCanvas?.(canvas);
    (async () => {
      let gpu: WebGpuStage | null = null;
      if (preferWebGpu) gpu = await WebGpuStage.create(canvas);
      if (cancelled) return;
      if (gpu) {
        stageRef.current = gpu;
        setBackend('webgpu');
      } else {
        stageRef.current = new Canvas2DStage(canvas);
        setBackend('canvas2d');
      }
    })();
    return () => {
      cancelled = true;
      onCanvas?.(null);
    };
    // Camera identity changes with every settings edit; canvas element stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera?.id, camera?.width, camera?.height, preferWebGpu, renderScale]);

  useEffect(() => {
    if (!world || !camera) return;
    let raf = 0;
    let lastRender = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // Four channels: cap each at ~45 fps; simulation remains higher priority.
      if (now - lastRender < 22) return;
      lastRender = now;
      const stage = stageRef.current;
      if (!stage || pausedRef.current) return;
      const batch = buildCameraBatch(world, camera);
      stage.render(batch, camera.width, camera.height, world.water(-camera.eye[1]), renderScale);
      frameCountRef.current++;
      const fpsElapsed = now - fpsWindowStartRef.current;
      if (fpsElapsed > 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / fpsElapsed));
        frameCountRef.current = 0;
        fpsWindowStartRef.current = now;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [world, camera, renderScale]);

  return (
    <div className={`camera-frame ${className ?? ''}`}>
      <canvas ref={canvasRef} className="camera-canvas" />
      <span className={`backend-badge ${backend}`}>{backend === 'webgpu' ? 'WebGPU' : backend === 'canvas2d' ? '2D兜底' : '初始化'}{fps > 0 ? ` · ${fps}fps` : ''}</span>
      {children}
    </div>
  );
}
