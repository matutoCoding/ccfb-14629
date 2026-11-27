import { useState } from 'react';
import { useAppData } from '../state/AppDataContext';
import { Panel, Field, Btn, Stat, Badge } from '../components/ui';
import type { Season, Settings as SettingsType } from '../types';
import { FishWorld } from '../sim/world';
import { makeStereoRig } from '../lib/camera';
import { autoMeasureWorld } from '../sim/measure';
import { accuracySummary } from '../lib/growth';

const SEASONS: { id: Season; label: string }[] = [
  { id: 'spring', label: '春季' }, { id: 'summer', label: '夏季' }, { id: 'autumn', label: '秋季' }, { id: 'winter', label: '冬季' },
];

export function SettingsPage() {
  const { settings, updateSettings, resetDemo, cages, rigs } = useAppData();
  const [selfTest, setSelfTest] = useState<{ correct: ReturnType<typeof accuracySummary>; biased: ReturnType<typeof accuracySummary> } | null>(null);
  const [testing, setTesting] = useState(false);
  if (!settings) return <Panel>加载设置…</Panel>;
  const s = settings;
  const set = (patch: Partial<SettingsType>) => updateSettings({ ...s, ...patch });

  async function runAccuracySelfTest() {
    const cage = cages[0];
    const rig = rigs.find((r) => r.cageId === cage?.id);
    if (!cage || !rig) return;
    setTesting(true);
    await new Promise((r) => setTimeout(r, 30));
    const radius = cage.perimeterM / (2 * Math.PI);
    const renderRig = makeStereoRig(rig, radius, { bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0 } });
    const correctMeasure = makeStereoRig(rig, radius, { bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0 } });
    const biasedMeasure = makeStereoRig(rig, radius, { bias: { baselinePct: -3, focalPct: 0.8, k1: 0, noisePx: 0 } });
    const world = new FishWorld(cage.id + '-selftest', cage.perimeterM, cage.netDepthM, 42, 372);
    const correctErrors: number[] = [];
    const biasedErrors: number[] = [];
    for (let step = 0; step < 12; step++) {
      world.update(0.7, [renderRig]);
      const common = {
        world, renderRig, settings: s, rigId: rig.id, cageId: cage.id, maxFish: 16,
      };
      const correct = autoMeasureWorld({ ...common, measureRig: correctMeasure, nonce: 2000 + step * 131, biased: false });
      correct.drafts.forEach((d) => correctErrors.push(d.errorPct!));
      const biased = autoMeasureWorld({ ...common, measureRig: biasedMeasure, nonce: 2000 + step * 131 + 19, biased: true });
      biased.drafts.forEach((d) => biasedErrors.push(d.errorPct!));
    }
    const summarize = (errors: number[]) => accuracySummary(errors.map((errorPct) => ({ errorPct } as any)));
    setSelfTest({ correct: summarize(correctErrors), biased: summarize(biasedErrors) });
    setTesting(false);
  }

  return (
    <div className="settings-grid">
      <Panel title="测量与自动选鱼">
        <div className="form-grid">
          <Field label="可信度阈值"><input type="number" step="0.01" min="0" max="1" value={s.confidenceThreshold} onChange={(e) => set({ confidenceThreshold: +e.target.value })} /></Field>
          <Field label="最大斜角 °"><input type="number" value={s.maxObliqueDeg} onChange={(e) => set({ maxObliqueDeg: +e.target.value })} /></Field>
          <Field label="标定角点噪声 px"><input type="number" step="0.02" value={s.calibrationNoisePx} onChange={(e) => set({ calibrationNoisePx: +e.target.value })} /></Field>
          <Field label="测量关键点噪声 px" hint="仿真检测器亚像素噪声"><input type="number" step="0.02" value={s.measurementNoisePx} onChange={(e) => set({ measurementNoisePx: +e.target.value })} /></Field>
          <Field label="自动测量间隔 秒"><input type="number" value={s.autoMeasureIntervalSec} onChange={(e) => set({ autoMeasureIntervalSec: +e.target.value })} /></Field>
        </div>
      </Panel>

      <Panel title="上市规格与投喂">
        <div className="form-grid">
          <Field label="上市体重 g"><input type="number" value={s.marketWeightG} onChange={(e) => set({ marketWeightG: +e.target.value })} /></Field>
          <Field label="上市叉长 mm"><input type="number" value={s.marketLengthMm} onChange={(e) => set({ marketLengthMm: +e.target.value })} /></Field>
          <Field label="当前水温 ℃"><input type="number" step="0.1" value={s.waterTempC} onChange={(e) => set({ waterTempC: +e.target.value })} /></Field>
          <Field label="基础投饵率下限 %"><input type="number" step="0.1" value={s.feedRateMinPct} onChange={(e) => set({ feedRateMinPct: +e.target.value })} /></Field>
          <Field label="基础投饵率上限 %"><input type="number" step="0.1" value={s.feedRateMaxPct} onChange={(e) => set({ feedRateMaxPct: +e.target.value })} /></Field>
        </div>
      </Panel>

      <Panel title="季节长重关系 W(g)=a·L(cm)^b">
        <div className="lw-grid">
          {SEASONS.map(({ id, label }) => (
            <div className="lw-card" key={id}>
              <h3>{label}</h3>
              <Field label="a 系数"><input type="number" step="0.0001" value={s.lengthWeight[id].a} onChange={(e) => set({ lengthWeight: { ...s.lengthWeight, [id]: { ...s.lengthWeight[id], a: +e.target.value } } })} /></Field>
              <Field label="b 指数"><input type="number" step="0.01" value={s.lengthWeight[id].b} onChange={(e) => set({ lengthWeight: { ...s.lengthWeight, [id]: { ...s.lengthWeight[id], b: +e.target.value } } })} /></Field>
              <Badge tone="muted">{weightPreview(s.lengthWeight[id].a, s.lengthWeight[id].b)}</Badge>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="WebGPU 与性能">
        <div className="form-grid">
          <Field label="优先 WebGPU" hint="不可用时自动使用 Canvas2D 渲染同一批几何"><input type="checkbox" checked={s.webgpuPreferred} onChange={(e) => set({ webgpuPreferred: e.target.checked })} /></Field>
          <Field label="低分辨率模式" hint="未来接真相机时用于弱工控机"><input type="checkbox" checked={s.reducedResolution} onChange={(e) => set({ reducedResolution: e.target.checked })} /></Field>
        </div>
        <p className="hint">当前仿真每路 960×540，鱼体网格批量投影；双目页四路镜头同时运行，渲染循环限制约 45fps，仿真与交互不经过 React 逐帧重渲染。</p>
      </Panel>

      <Panel title="测量精度自检" extra={<Btn variant="primary" onClick={runAccuracySelfTest} disabled={testing}>{testing ? '自检中…' : '运行无偏/偏参对照'}</Btn>}>
        {selfTest ? (
          <div className="stats-grid">
            <Stat label="正确参数 MAPE" value={selfTest.correct.mape.toFixed(2)} unit="%" tone={selfTest.correct.mape <= 2 ? 'good' : 'bad'} hint={`${selfTest.correct.count} 个样本，偏差 ${selfTest.correct.bias.toFixed(2)}%`} />
            <Stat label="−3%基线/+0.8%焦距 MAPE" value={selfTest.biased.mape.toFixed(2)} unit="%" tone="bad" hint={`偏差 ${selfTest.biased.bias.toFixed(2)}%，系统不会掩盖`} />
          </div>
        ) : <p className="hint">将运行 10 个仿真时刻、约数百个三角测量样本。正确参数下平均绝对百分比误差应低于 2%；故意改错基线/焦距后会稳定显示同方向偏差。</p>}
      </Panel>

      <Panel title="数据与重置">
        <p>所有网箱、相机、标定档案、测量记录和设置均保存在浏览器 IndexedDB。清除站点数据会删除这些记录。</p>
        <Btn variant="danger" onClick={() => { if (confirm('清空并重建 12 口示范网箱、历史测量和默认相机？')) resetDemo(); }}>重置示范数据</Btn>
      </Panel>
    </div>
  );
}

function weightPreview(a: number, b: number) {
  const w = a * Math.pow(35, b);
  return `35cm ≈ ${w.toFixed(0)}g`;
}
