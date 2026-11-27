import { useEffect, useMemo, useState } from 'react';
import { useAppData } from '../state/AppDataContext';
import { Btn, Panel, Badge, Stat } from '../components/ui';
import { CameraCanvas } from '../components/CameraCanvas';
import { cageRadius, useFishWorld, useMeasureRig, useTrueRig } from '../state/simHooks';
import { makeStereoRig, epipolarCurve, type StereoRigModel } from '../lib/camera';
import {
  autoMeasureWorld,
  buildKeypointCandidates,
  evaluateFish,
  matchRightAlongEpipolar,
  snapLeftCandidate,
  measureCandidateAxis,
  type CandidateKeypoint,
  type FishEvaluation,
} from '../sim/measure';
import type { MeasurementRecord } from '../types';
import { accuracySummary } from '../lib/growth';
import { uid } from '../lib/math3d';

interface ClickPoint {
  left: [number, number];
  right: [number, number];
  spineIndex: number;
  fishId: string;
  epipolarPx: number;
}

export function StereoPage() {
  const { cages, rigs, calibrations, settings, addMeasurements, saveRig, updateSettings } = useAppData();
  const [cageId, setCageId] = useState(settings?.activeCageId ?? cages[0]?.id ?? '');
  const cage = cages.find((c) => c.id === cageId) ?? cages[0];
  const cageRigs = useMemo(() => rigs.filter((r) => r.cageId === cage?.id), [rigs, cage?.id]);
  const [rigId, setRigId] = useState(settings?.activeRigId ?? cageRigs[0]?.id ?? rigs[0]?.id ?? '');
  const rig = cageRigs.find((r) => r.id === rigId) ?? cageRigs[0] ?? rigs.find((r) => r.id === rigId);
  const [calibChoice, setCalibChoice] = useState<'active' | 'factory' | string>('active');
  const calibration = calibChoice === 'active'
    ? calibrations.find((c) => c.id === rig?.activeCalibrationId)
    : calibChoice === 'factory' ? undefined : calibrations.find((c) => c.id === calibChoice);

  const trueRig = useTrueRig(rig, cage);
  const measureRig = useMeasureRig(rig, cage, calibration ?? null, settings);
  const allTrueRigs = useMemo<StereoRigModel[]>(() => {
    if (!cage) return [];
    return cageRigs.map((r) => makeStereoRig(r, cageRadius(cage), { bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0 } }));
  }, [cage, cageRigs]);

  const [paused, setPaused] = useState(false);
  const world = useFishWorld(cage, allTrueRigs, 58, paused);
  const [nonce, setNonce] = useState(7);
  const candidates = useMemo<CandidateKeypoint[]>(() => {
    if (!world || !trueRig || !settings) return [];
    return buildKeypointCandidates(world, trueRig, settings.measurementNoisePx, nonce);
    // nonce is intentionally the freeze/detection trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, trueRig, nonce, paused]);

  const [clicks, setClicks] = useState<ClickPoint[]>([]);
  const [manualFishId, setManualFishId] = useState<string | null>(null);
  const [results, setResults] = useState<MeasurementRecord[]>([]);
  const [evaluations, setEvaluations] = useState<FishEvaluation[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('在左目画面点击鱼的吻端、中轴点和尾叉；右目沿极线自动匹配。');

  useEffect(() => { if (!cageId && cages[0]) setCageId(cages[0].id); }, [cages, cageId]);
  useEffect(() => {
    if (cage && !cageRigs.some((r) => r.id === rigId) && cageRigs[0]) setRigId(cageRigs[0].id);
  }, [cage, cageRigs, rigId]);

  if (!settings || !cage || !rig || !trueRig || !measureRig || !world) {
    return <Panel>正在初始化双目仿真…</Panel>;
  }

  const biased = Math.abs(rig.bias.baselinePct) > 0.001 || Math.abs(rig.bias.focalPct) > 0.001 || Math.abs(rig.bias.k1) > 0.0001 || calibration === undefined && false;
  const summary = accuracySummary(results);
  const channelCameras = allTrueRigs.flatMap((r) => [
    { rigId: r.rigId, side: 'L' as const, cam: r.left },
    { rigId: r.rigId, side: 'R' as const, cam: r.right },
  ]);

  async function selectCage(id: string) {
    setCageId(id);
    const first = rigs.find((r) => r.cageId === id);
    if (first) { setRigId(first.id); if (settings) await updateSettings({ ...settings, activeCageId: id, activeRigId: first.id }); }
    setClicks([]); setResults([]); setManualFishId(null);
  }
  async function selectRig(id: string) {
    setRigId(id); setClicks([]); setResults([]); setManualFishId(null);
    if (settings) await updateSettings({ ...settings, activeRigId: id });
  }

  function freezeForManual() {
    setPaused(true);
    setNonce((n) => n + 1);
    setClicks([]);
    setManualFishId(null);
    setMessage('已冻结当前帧。请在左目点击：吻端 → 0–3 个弯曲中轴点 → 尾叉。');
  }
  function resume() {
    setPaused(false);
    setClicks([]); setResults([]); setManualFishId(null);
    setMessage('实时画面中；自动测量会自动冻结一帧用于对账。');
  }

  function svgPoint(e: React.MouseEvent<SVGSVGElement>): [number, number] {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * rig.width,
      ((e.clientY - rect.top) / rect.height) * rig.height,
    ];
  }

  function onLeftClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!paused) freezeForManual();
    const px = svgPoint(e);
    const snap = snapLeftCandidate(px, candidates, 30);
    if (!snap) {
      setMessage('附近没有检测到鱼体关键点，请靠近吻端、尾叉或背脊中轴再点。');
      return;
    }
    if (manualFishId && snap.fishId !== manualFishId) {
      setMessage('已切换到另一条鱼；请先完成或撤销当前鱼的点选。');
      return;
    }
    const match = matchRightAlongEpipolar({
      leftPx: snap.left, measureRig: measureRig!, candidates,
      fishId: snap.fishId, spineIndex: snap.spineIndex, maxEpipolarPx: 46,
    });
    const right = match?.point ?? snap.right;
    setManualFishId(snap.fishId);
    setClicks((cs) => [...cs, {
      left: snap.left, right, spineIndex: snap.spineIndex, fishId: snap.fishId,
      epipolarPx: match?.epipolarPx ?? -1,
    }]);
    setMessage(match ? `右目极线匹配成功，极线偏差 ${match.epipolarPx.toFixed(2)}px。` : '极线残差较大，使用仿真特征候选；请检查标定偏差。');
  }

  async function measureManualFish() {
    if (!manualFishId || clicks.length < 2) {
      setMessage('请至少点击吻端和尾叉两个点；鱼身弯曲时可在中间加 1–3 个中轴点。');
      return;
    }
    const fish = world!.fishes.find((f) => f.id === manualFishId);
    if (!fish) return;
    const evaluation = evaluateFish(world!, fish, trueRig!, settings!);
    const leftPoints = clicks.map((c) => c.left);
    const rightPoints = clicks.map((c) => c.right);
    const draft = measureCandidateAxis({
      fish, renderRig: trueRig!, measureRig: measureRig!, settings: settings!, nonce, rigId: rig.id, cageId: cage.id,
      method: 'manual', segmentCount: clicks.length - 1, leftPoints, rightPoints,
      evaluation, calibrationId: calibration?.id, biased,
    });
    if (!draft) { setMessage('三角测量失败：交点发散，请重新选点或检查标定。'); return; }
    const record: MeasurementRecord = { ...draft, id: uid('m'), measuredAt: new Date().toISOString() };
    await addMeasurements([record]);
    setResults((rs) => [record, ...rs]);
    setMessage(`手动分段测量完成：${record.forkLengthMm.toFixed(1)} mm，真值 ${record.trueLengthMm?.toFixed(1)} mm，误差 ${record.errorPct?.toFixed(2)}%。`);
  }

  async function runAuto() {
    setBusy(true);
    setPaused(true);
    const runNonce = Math.floor(Math.random() * 1e9);
    setNonce(runNonce);
    // Let React commit paused/nonce before the synchronous heavy evaluation.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const out = autoMeasureWorld({
        world: world!, renderRig: trueRig!, measureRig: measureRig!, settings: settings!, rigId: rig.id, cageId: cage.id,
        calibrationId: calibration?.id, biased, nonce: runNonce, maxFish: 8,
      });
      const records: MeasurementRecord[] = out.drafts.map((d) => ({ ...d, id: uid('m'), measuredAt: new Date().toISOString() }));
      await addMeasurements(records);
      setResults(records);
      setEvaluations(out.evaluations);
    } finally {
      setBusy(false);
    }
  }

  async function setBias(patch: Partial<typeof rig.bias>) {
    await saveRig({ ...rig, bias: { ...rig.bias, ...patch } });
  }

  const lastCurve = clicks.length ? epipolarCurve(clicks[clicks.length - 1].left, measureRig.left, measureRig.right, 90) : [];
  const selectedResults = results.filter((r) => r.rigId === rig.id);
  const eligibleCount = evaluations.filter((e) => e.eligible).length;
  const skipped = evaluations.filter((e) => !e.eligible).slice(0, 5);

  return (
    <div className="stereo-page">
      <Panel className="control-panel">
        <div className="controls-row">
          <label>网箱
            <select value={cage.id} onChange={(e) => selectCage(e.target.value)}>
              {cages.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </label>
          <label>测量双目
            <select value={rig.id} onChange={(e) => selectRig(e.target.value)}>
              {cageRigs.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.baselineMm}mm</option>)}
            </select>
          </label>
          <label>测量参数
            <select value={calibChoice} onChange={(e) => setCalibChoice(e.target.value)}>
              <option value="active">应用相机当前标定</option>
              <option value="factory">仿真出厂真值（无偏差）</option>
              {calibrations.filter((c) => c.rigId === rig.id).map((c) => <option key={c.id} value={c.id}>{c.createdAt.slice(0, 16)} · RMS {c.rmsPx.toFixed(2)}</option>)}
            </select>
          </label>
          <Btn variant="primary" onClick={runAuto} disabled={busy}>{busy ? '自动测量中…' : '自动挑鱼并测量'}</Btn>
          <Btn onClick={freezeForManual}>冻结/手动点选</Btn>
          <Btn variant="good" disabled={clicks.length < 2} onClick={measureManualFish}>测量{clicks.length >= 2 ? `（${clicks.length}点）` : '（至少2点）'}</Btn>
          <Btn onClick={() => {
            setClicks((cs) => cs.slice(0, -1));
            if (clicks.length <= 1) setManualFishId(null);
          }} disabled={!clicks.length}>撤销上一点</Btn>
          <Btn onClick={resume}>{paused ? '继续实时' : '刷新结果'}</Btn>
        </div>
        <div className="bias-row">
          <span>故意给错参数：</span>
          <Btn size="sm" variant={!biased ? 'good' : 'ghost'} onClick={() => setBias({ baselinePct: 0, focalPct: 0, k1: 0 })}>归零</Btn>
          <Btn size="sm" variant={rig.bias.baselinePct === -3 ? 'warn' : 'ghost'} onClick={() => setBias({ baselinePct: -3 })}>基线 −3%</Btn>
          <Btn size="sm" variant={rig.bias.focalPct === 2 ? 'warn' : 'ghost'} onClick={() => setBias({ focalPct: 2 })}>焦距 +2%</Btn>
          <Btn size="sm" variant={Math.abs(rig.bias.k1 - 0.03) < 0.001 ? 'warn' : 'ghost'} onClick={() => setBias({ k1: 0.03 })}>k1 +0.03</Btn>
          <label className="mini-input">基线%<input type="number" step="0.1" value={rig.bias.baselinePct} onChange={(e) => setBias({ baselinePct: +e.target.value })} /></label>
          <label className="mini-input">焦距%<input type="number" step="0.1" value={rig.bias.focalPct} onChange={(e) => setBias({ focalPct: +e.target.value })} /></label>
          <Badge tone={biased ? 'bad' : 'good'}>{biased ? '测量参数存在故意偏差，对账会显示出来' : '参数无附加偏差'}</Badge>
        </div>
      </Panel>

      <div className="accuracy-strip">
        <Stat label="本轮对账样本" value={summary.count} unit="条" />
        <Stat label="平均绝对百分比误差" value={summary.count ? summary.mape.toFixed(2) : '—'} unit="%" tone={summary.count && summary.mape <= 2 ? 'good' : 'bad'} hint="目标：正确标定 ≤ 2%" />
        <Stat label="系统偏差（正偏大/负偏小）" value={summary.count ? summary.bias.toFixed(2) : '—'} unit="%" tone={Math.abs(summary.bias) <= 2 ? 'good' : 'bad'} />
        <Stat label="≤2%占比" value={summary.count ? (summary.goodPct * 100).toFixed(0) : '—'} unit="%" />
        <Stat label="自动选鱼" value={`${eligibleCount}/${world.fishes.length}`} hint={skipped[0]?.reasons[0] ?? '侧身、完整、无遮挡才测量'} />
      </div>

      <Panel title={`四路相机同开 · ${cage.code} · ${channelCameras.length} 个镜头`} extra={<Badge tone="accent">960×540 · WebGPU 批量投影 · 每路约45fps上限</Badge>}>
        <div className="channels-layout">
          {channelCameras.map(({ rigId: rid, side, cam }) => {
            const isSelected = rid === rig.id;
            const model = allTrueRigs.find((r) => r.rigId === rid)!;
            return (
              <CameraCanvas
                key={`${rid}-${side}`}
                world={world}
                camera={cam}
                preferWebGpu={settings.webgpuPreferred}
                lowResolution={settings.reducedResolution}
                className={isSelected ? `channel-main channel-${side.toLowerCase()}` : 'channel-small'}
              >
                {isSelected && side === 'L' && (
                  <LeftOverlay rig={rig} clicks={clicks} results={selectedResults} onClick={onLeftClick} />
                )}
                {isSelected && side === 'R' && (
                  <RightOverlay rig={rig} clicks={clicks} curve={lastCurve} results={selectedResults} />
                )}
                <span className="cam-title">{cageRigs.find((r) => r.id === rid)?.name} · {side === 'L' ? '左目' : '右目'}</span>
                {isSelected && <span className="selected-tag">测量通道</span>}
              </CameraCanvas>
            );
          })}
        </div>
        <p className="interaction-message">{message}</p>
      </Panel>

      <div className="bottom-grid">
        <Panel title="自动选鱼与跳过原因">
          <div className="eval-list">
            {evaluations.slice(0, 10).map((e) => (
              <div key={e.fish.id} className={`eval-row ${e.eligible ? 'ok' : 'skip'}`}>
                <strong>{e.fish.id}</strong>
                <Badge tone={e.eligible ? 'good' : 'bad'}>{e.eligible ? '采用' : '跳过'}</Badge>
                <span>斜角 {e.obliqueDeg.toFixed(0)}°</span>
                <span>遮挡 {e.occlusionPct.toFixed(0)}%</span>
                <span>可信度 {e.confidence.toFixed(2)}</span>
                <em>{e.reasons.join('；') || '侧身、整条入画、无明显遮挡'}</em>
              </div>
            ))}
            {!evaluations.length && <div className="empty">点击“自动挑鱼并测量”后列出每条鱼的判断。</div>}
          </div>
        </Panel>

        <Panel title="仿真真值对账" extra={<Badge tone={summary.mape <= 2 ? 'good' : 'bad'}>{summary.count ? `MAPE ${summary.mape.toFixed(2)}%` : '等待测量'}</Badge>}>
          <div className="recon-table-wrap">
            <table className="data-table">
              <thead><tr><th>鱼</th><th>方法</th><th>测量叉长</th><th>真值</th><th>误差</th><th>误差%</th><th>可信度</th></tr></thead>
              <tbody>
                {results.slice(0, 18).map((r) => (
                  <tr key={r.id}>
                    <td>{r.truthFishId}</td>
                    <td>{r.method === 'auto' ? '自动' : '手动'}</td>
                    <td className="num">{r.forkLengthMm.toFixed(1)}</td>
                    <td className="num">{r.trueLengthMm?.toFixed(1)}</td>
                    <td className={`num ${(r.errorMm ?? 0) >= 0 ? 'bad' : 'warn'}`}>{r.errorMm != null ? `${r.errorMm >= 0 ? '+' : ''}${r.errorMm.toFixed(1)}` : '—'}</td>
                    <td className={`num ${Math.abs(r.errorPct ?? 0) <= 2 ? 'good' : 'bad'}`}>{r.errorPct != null ? `${r.errorPct >= 0 ? '+' : ''}${r.errorPct.toFixed(2)}%` : '—'}</td>
                    <td className="num">{r.confidence.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!results.length && <div className="empty">测量后这里逐条列出仿真真值和偏差；错参数不会被平均或过滤掉。</div>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function resultPaths(r: MeasurementRecord, side: 'left' | 'right') {
  if (!r.segments?.length) return [] as [number, number][][];
  return r.segments.map((s) => [side === 'left' ? s.leftA! : s.rightA!, side === 'left' ? s.leftB! : s.rightB!]);
}

function LeftOverlay({ rig, clicks, results, onClick }: {
  rig: { width: number; height: number };
  clicks: ClickPoint[];
  results: MeasurementRecord[];
  onClick: (e: React.MouseEvent<SVGSVGElement>) => void;
}) {
  return (
    <svg className="overlay-svg" viewBox={`0 0 ${rig.width} ${rig.height}`} onClick={onClick}>
      {results.map((r) => (
        <g key={r.id} pointerEvents="none">
          {resultPaths(r, 'left').map((pair, i) => <line key={i} x1={pair[0][0]} y1={pair[0][1]} x2={pair[1][0]} y2={pair[1][1]} stroke="#22c55e" strokeWidth={3} />)}
          <circle cx={r.leftSnout[0]} cy={r.leftSnout[1]} r={7} fill="none" stroke="#22d3ee" strokeWidth={3} />
          <circle cx={r.leftTail[0]} cy={r.leftTail[1]} r={7} fill="none" stroke="#f59e0b" strokeWidth={3} />
          <text x={r.leftSnout[0] + 10} y={r.leftSnout[1] - 10} className="svg-label good">{r.forkLengthMm.toFixed(0)}mm {r.errorPct != null ? `${r.errorPct >= 0 ? '+' : ''}${r.errorPct.toFixed(1)}%` : ''}</text>
        </g>
      ))}
      {clicks.map((p, i) => <g key={i} pointerEvents="none"><circle cx={p.left[0]} cy={p.left[1]} r={6} fill="#38bdf8" stroke="#fff" strokeWidth={2} /><text x={p.left[0] + 9} y={p.left[1] - 8} className="svg-label">{i + 1}</text></g>)}
      <rect x={0} y={0} width={rig.width} height={rig.height} fill="transparent" />
    </svg>
  );
}

function RightOverlay({ rig, clicks, curve, results }: {
  rig: { width: number; height: number };
  clicks: ClickPoint[];
  curve: [number, number][];
  results: MeasurementRecord[];
}) {
  const path = curve.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg className="overlay-svg" viewBox={`0 0 ${rig.width} ${rig.height}`}>
      {curve.length > 1 && <path d={path} fill="none" stroke="#e879f9" strokeWidth={2.5} strokeDasharray="8 5" opacity={0.9} />}
      {results.map((r) => (
        <g key={r.id} pointerEvents="none">
          {resultPaths(r, 'right').map((pair, i) => <line key={i} x1={pair[0][0]} y1={pair[0][1]} x2={pair[1][0]} y2={pair[1][1]} stroke="#22c55e" strokeWidth={3} />)}
          <circle cx={r.rightSnout[0]} cy={r.rightSnout[1]} r={7} fill="none" stroke="#22d3ee" strokeWidth={3} />
          <circle cx={r.rightTail[0]} cy={r.rightTail[1]} r={7} fill="none" stroke="#f59e0b" strokeWidth={3} />
        </g>
      ))}
      {clicks.map((p, i) => <g key={i}><circle cx={p.right[0]} cy={p.right[1]} r={6} fill="#e879f9" stroke="#fff" strokeWidth={2} /><text x={p.right[0] + 9} y={p.right[1] - 8} className="svg-label">{i + 1} · {p.epipolarPx >= 0 ? `${p.epipolarPx.toFixed(1)}px` : '候选'}</text></g>)}
    </svg>
  );
}
