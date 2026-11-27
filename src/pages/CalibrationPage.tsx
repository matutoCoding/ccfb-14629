import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../state/AppDataContext';
import { Btn, Panel, Badge, Field, Spinner } from '../components/ui';
import { cageRadius, useTrueRig } from '../state/simHooks';
import {
  averageStereoExtrinsics,
  calibrateMono,
  capturesToMonoInputs,
  generateCalibrationCaptures,
  type MonoCalibrationResult,
  type CalibrationCapture,
} from '../lib/calibration';
import type { CalibrationImageStat, CalibrationProfile } from '../types';
import { uid } from '../lib/math3d';

export function CalibrationPage() {
  const { cages, rigs, settings, calibrations, saveCalibration, saveRig, updateSettings } = useAppData();
  const [rigId, setRigId] = useState(settings?.activeRigId ?? rigs[0]?.id ?? '');
  const rig = rigs.find((r) => r.id === rigId) ?? rigs[0];
  const cage = cages.find((c) => c.id === rig?.cageId);
  const trueRig = useTrueRig(rig, cage);
  const [cols] = useState(9);
  const [rows] = useState(6);
  const [squareMm] = useState(60);
  const [count] = useState(14);
  const [captures, setCaptures] = useState<CalibrationCapture[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [leftResult, setLeftResult] = useState<MonoCalibrationResult | null>(null);
  const [rightResult, setRightResult] = useState<MonoCalibrationResult | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statsMap, setStatsMap] = useState<Record<number, { l: CalibrationImageStat; r: CalibrationImageStat }>>({});
  const [savedId, setSavedId] = useState<string | null>(rig?.activeCalibrationId ?? null);
  const [solveError, setSolveError] = useState<string | null>(null);

  useEffect(() => { if (!rigId && rigs[0]) setRigId(rigs[0].id); }, [rigs, rigId]);
  useEffect(() => {
    if (!trueRig) return;
    setCaptures(generateCalibrationCaptures(trueRig, cols, rows, squareMm, count, settings?.calibrationNoisePx ?? 0.16));
    setLeftResult(null); setRightResult(null); setStatsMap({}); setExcluded(new Set()); setSavedId(rig?.activeCalibrationId ?? null);
  }, [trueRig?.rigId, cols, rows, squareMm, count, settings?.calibrationNoisePx]); // eslint-disable-line react-hooks/exhaustive-deps

  const includedCaptures = useMemo(() => captures.filter((c) => !excluded.has(c.index)), [captures, excluded]);
  const selectedCapture = captures.find((c) => c.index === selectedIndex) ?? captures[0];
  const existing = calibrations.filter((c) => c.rigId === rig?.id);

  async function solve(nextExcluded = excluded) {
    if (!trueRig || !rig || !cage) return;
    setBusy(true); setProgress(0); setSolveError(null);
    try {
      const caps = captures.filter((c) => !nextExcluded.has(c.index));
      const byOriginalIndex = new Map(captures.map((c) => [c.index, c]));
      const initialK = trueRig.left.intrinsics;
      setProgressLabel('解算左目内参、外参与畸变…');
      const left = await calibrateMono(capturesToMonoInputs(caps, 'left'), initialK, rig.glass, {
        maxIterations: 18,
        onProgress: (p, label) => { setProgress(p * 0.48); setProgressLabel(label); },
      });
      setProgressLabel('解算右目…');
      const right = await calibrateMono(capturesToMonoInputs(caps, 'right'), trueRig.right.intrinsics, rig.glass, {
        maxIterations: 18,
        initialDistortion: left.distortion,
        onProgress: (p, label) => { setProgress(0.5 + p * 0.48); setProgressLabel(label); },
      });
      setLeftResult(left); setRightResult(right);
      const map: Record<number, { l: CalibrationImageStat; r: CalibrationImageStat }> = {};
      left.images.forEach((l) => {
        const cap = byOriginalIndex.get(l.index);
        const rr = right.images.find((x) => x.index === l.index);
        if (!cap || !rr) return;
        map[l.index] = { l: { ...l, id: cap.id, included: true }, r: { ...rr, id: `${cap.id}-r`, included: true } };
      });
      setStatsMap((old) => ({ ...old, ...map }));
      setProgress(1); setProgressLabel('完成');
    } catch (err) {
      console.error(err);
      setSolveError(err instanceof Error ? err.message : String(err));
      setProgressLabel('解算失败');
    } finally {
      setBusy(false);
    }
  }

  function excludeWorstAndRecompute() {
    const rows = captures.map((c) => ({ c, stat: statsMap[c.index] })).filter((x) => x.stat && !excluded.has(x.c.index));
    rows.sort((a, b) => Math.max(b.stat.l.rmsPx, b.stat.r.rmsPx) - Math.max(a.stat.l.rmsPx, a.stat.r.rmsPx));
    const worst = rows[0];
    if (!worst) return;
    const next = new Set(excluded); next.add(worst.c.index);
    setExcluded(next);
    solve(next);
  }

  async function saveAndApply() {
    if (!leftResult || !rightResult || !rig || !cage) return;
    const stereo = averageStereoExtrinsics(leftResult.images, rightResult.images);
    const images: CalibrationImageStat[] = captures.map((c) => {
      const s = statsMap[c.index]?.l;
      if (s) return { ...s, included: !excluded.has(c.index) };
      return {
        id: c.id, index: c.index, capturedAt: c.capturedAt, poseLabel: c.poseLabel,
        cornerCount: c.leftPixels.length, rmsPx: 99, maxErrorPx: 99, included: false,
        badSample: c.badSample, rvec: [0, 0, 0], tvec: [0, 0, 1],
      };
    });
    const profile: CalibrationProfile = {
      id: savedId ?? uid('cal'),
      rigId: rig.id, cageId: cage.id, createdAt: new Date().toISOString(),
      boardCols: cols, boardRows: rows, squareMm, imageCount: captures.length,
      usedImageCount: includedCaptures.length,
      intrinsics: leftResult.intrinsics,
      distortion: leftResult.distortion,
      stereoR: stereo.R, stereoT: stereo.T, stereoBaselineMm: stereo.baselineMm || rig.baselineMm,
      rmsPx: (leftResult.rmsPx + rightResult.rmsPx) / 2,
      maxRmsPx: Math.max(...images.filter((i) => i.included).map((i) => i.rmsPx), 0),
      images, glass: rig.glass, solverIterations: 14,
      note: excluded.size ? `已剔除 ${[...excluded].map((i) => i + 1).join('、')} 组` : undefined,
    };
    await saveCalibration(profile);
    await saveRig({ ...rig, activeCalibrationId: profile.id });
    if (settings) await updateSettings({ ...settings, activeRigId: rig.id, activeCageId: cage.id });
    setSavedId(profile.id);
  }

  const worst = Object.entries(statsMap).sort((a, b) => Math.max(b[1].l.rmsPx, b[1].r.rmsPx) - Math.max(a[1].l.rmsPx, a[1].r.rmsPx))[0];

  return (
    <div className="page-grid calibration-page">
      <Panel title="标定相机选择" className="calib-side">
        <Field label="双目相机">
          <select value={rigId} onChange={(e) => setRigId(e.target.value)}>
            {rigs.map((r) => <option key={r.id} value={r.id}>{cages.find((c) => c.id === r.cageId)?.code} · {r.name}</option>)}
          </select>
        </Field>
        <div className="calib-spec">
          <p>棋盘格内角点 <b>{cols}×{rows}</b>，方格 <b>{squareMm}mm</b></p>
          <p>已生成 <b>{captures.length}</b> 组水下标定姿态；其中预置 1 组运动模糊/误检。</p>
          <p>投影模型包含 Brown–Conrady 畸变和玻璃罩 Snell 折射。</p>
        </div>
        <div className="button-column">
          <Btn variant="primary" disabled={busy || !captures.length} onClick={() => solve()}>{busy ? <Spinner text={progressLabel || '解算中'} /> : leftResult ? '重新解算全部' : '开始解算内参/外参/畸变'}</Btn>
          <Btn variant="warn" disabled={busy || !leftResult} onClick={excludeWorstAndRecompute}>剔除误差最大组并重算</Btn>
          <Btn variant="good" disabled={busy || !leftResult} onClick={saveAndApply}>保存并应用到测量</Btn>
        </div>
        {busy && <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>}
        {solveError && <p className="error-text">标定解算失败：{solveError}</p>}
        {leftResult && (
          <div className="calib-result">
            <h3>解算结果</h3>
            <ul>
              <li><span>fx / fy</span><b>{leftResult.intrinsics.fx.toFixed(1)} / {leftResult.intrinsics.fy.toFixed(1)} px</b></li>
              <li><span>主点</span><b>{leftResult.intrinsics.cx.toFixed(1)}, {leftResult.intrinsics.cy.toFixed(1)}</b></li>
              <li><span>k1 / k2</span><b>{leftResult.distortion.k1.toFixed(4)}, {leftResult.distortion.k2.toFixed(4)}</b></li>
              <li><span>k3</span><b>{leftResult.distortion.k3.toFixed(4)}</b></li>
              <li><span>左/右 RMS</span><b>{leftResult.rmsPx.toFixed(3)} / {rightResult?.rmsPx.toFixed(3)} px</b></li>
              <li><span>立体基线</span><b>{worst ? averageStereoExtrinsics(leftResult.images, rightResult?.images ?? []).baselineMm.toFixed(1) : rig?.baselineMm} mm</b></li>
            </ul>
            {savedId && <Badge tone="good">已保存并应用：{savedId.slice(0, 10)}</Badge>}
          </div>
        )}
        {existing.length > 0 && <p className="hint">本相机已有 {existing.length} 份标定档案，可在测量页选择。</p>}
      </Panel>

      <Panel
        title="水下棋盘格采集与逐张重投影误差"
        extra={worst ? <Badge tone="bad">最大：第 {Number(worst[0]) + 1} 组 {Math.max(worst[1].l.rmsPx, worst[1].r.rmsPx).toFixed(2)}px</Badge> : <Badge>尚未解算</Badge>}
        className="calib-main"
      >
        <div className="calib-preview-layout">
          <CapturePreview capture={selectedCapture} cols={cols} rows={rows} stats={selectedCapture ? statsMap[selectedCapture.index] : undefined} excluded={selectedCapture ? excluded.has(selectedCapture.index) : false} />
          <div className="calib-table-wrap">
            <table className="data-table calib-table">
              <thead><tr><th>采用</th><th>组</th><th>姿态</th><th>左 RMS</th><th>右 RMS</th><th>最大点</th><th>操作</th></tr></thead>
              <tbody>
                {captures.map((c) => {
                  const s = statsMap[c.index];
                  const isExcluded = excluded.has(c.index);
                  return (
                    <tr key={c.id} className={`${selectedCapture?.id === c.id ? 'selected' : ''} ${isExcluded ? 'excluded' : ''}`} onClick={() => setSelectedIndex(c.index)}>
                      <td><input type="checkbox" checked={!isExcluded} onChange={(e) => {
                        const next = new Set(excluded);
                        if (e.target.checked) next.delete(c.index); else next.add(c.index);
                        setExcluded(next);
                      }} onClick={(ev) => ev.stopPropagation()} /></td>
                      <td>{c.index + 1}{c.badSample && <Badge tone="warn">坏样本</Badge>}</td>
                      <td>{c.poseLabel}</td>
                      <td className={s && s.l.rmsPx > 1 ? 'num bad' : 'num good'}>{s ? s.l.rmsPx.toFixed(3) : '—'}</td>
                      <td className={s && s.r.rmsPx > 1 ? 'num bad' : 'num good'}>{s ? s.r.rmsPx.toFixed(3) : '—'}</td>
                      <td className="num">{s ? Math.max(s.l.maxErrorPx, s.r.maxErrorPx).toFixed(2) : '—'}</td>
                      <td><Btn size="sm" onClick={(e) => { e.stopPropagation(); setSelectedIndex(c.index); }}>查看</Btn></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="calib-recompute-row">
              <Btn disabled={busy || !leftResult} onClick={() => solve()}>按勾选组重算（{includedCaptures.length} 组）</Btn>
              <span className="hint">剔除不会删除原始采集；保存档案会记录未采用组。</span>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function CapturePreview({ capture, cols, rows, stats, excluded }: { capture?: CalibrationCapture; cols: number; rows: number; stats?: { l: CalibrationImageStat; r: CalibrationImageStat }; excluded: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !capture) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width = 720, H = canvas.height = 405;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b4b55'); g.addColorStop(1, '#082f3a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Scale simulation pixels (960x540) into preview.
    const sx = W / 960, sy = H / 540;
    const pts = capture.leftPixels.map(([x, y]) => [x * sx, y * sy]);
    const cellW = cols - 1;
    for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cellW; x++) {
      const a = pts[y * cols + x], b = pts[y * cols + x + 1], c = pts[(y + 1) * cols + x + 1], d = pts[(y + 1) * cols + x];
      if (!a || !b || !c || !d) continue;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
      ctx.fillStyle = (x + y) % 2 ? 'rgba(235,238,220,.88)' : 'rgba(20,28,30,.92)';
      ctx.fill();
    }
    pts.forEach(([x, y], i) => {
      ctx.beginPath(); ctx.arc(x, y, capture.badSample && i === Math.floor(capture.objectPoints.length / 2) ? 5 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = excluded ? '#94a3b8' : stats && stats.l.errors?.[i] && stats.l.errors[i] > 1.5 ? '#f87171' : '#22d3ee';
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.font = '14px system-ui';
    ctx.fillText(`左目采集 · ${capture.poseLabel}`, 14, 24);
    if (stats) ctx.fillText(`RMS ${stats.l.rmsPx.toFixed(3)} px · max ${stats.l.maxErrorPx.toFixed(2)} px`, 14, H - 16);
    if (excluded) {
      ctx.fillStyle = 'rgba(127,29,29,.55)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fecaca'; ctx.font = 'bold 34px system-ui'; ctx.fillText('已剔除', W / 2 - 68, H / 2);
    }
  }, [capture, stats, excluded, cols]);
  return <div className="capture-preview"><canvas ref={ref} /></div>;
}
