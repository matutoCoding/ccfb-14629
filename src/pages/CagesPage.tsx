import { useMemo, useState } from 'react';
import { useAppData } from '../state/AppDataContext';
import { Btn, Field, Panel, Badge } from '../components/ui';
import type { Cage, CameraRig } from '../types';
import { uid } from '../lib/math3d';

function emptyCage(existing: Cage[]): Cage {
  const n = existing.length + 1;
  return {
    id: uid('cage'), code: `DHY-${String(n).padStart(2, '0')}`, name: `${n}号深水网箱`,
    perimeterM: 48, netDepthM: 12, stockingDate: new Date().toISOString().slice(0, 10),
    species: '大黄鱼', stockCount: 12000, survivalRate: 0.88, season: 'autumn', createdAt: new Date().toISOString(),
  };
}

function emptyRig(cageId: string, n: number): CameraRig {
  return {
    id: uid('rig'), cageId, name: `相机${n + 1}`, installDepthM: 2.5, mountAzimuthDeg: n * 170,
    yawDeg: 0, pitchDeg: 10, rollDeg: 0, baselineMm: 620, focalLengthMm: 5.8, sensorWidthMm: 7.2,
    width: 960, height: 540,
    glass: { enabled: true, airGapM: 0.018, thicknessM: 0.008, iorGlass: 1.52, iorWater: 1.333 },
    trueDistortion: { k1: -0.118, k2: 0.026, p1: 0.0004, p2: -0.0003, k3: 0.006 },
    activeCalibrationId: null, principalPointXRatio: 0.5, principalPointYRatio: 0.5,
    bias: { baselinePct: 0, focalPct: 0, k1: 0, noisePx: 0.28 }, createdAt: new Date().toISOString(),
  };
}

export function CagesPage() {
  const { cages, rigs, calibrations, saveCage, deleteCage, saveRig, deleteRig } = useAppData();
  const [selectedId, setSelectedId] = useState(cages[0]?.id ?? '');
  const selected = cages.find((c) => c.id === selectedId) ?? cages[0];
  const cageRigs = useMemo(() => rigs.filter((r) => r.cageId === selected?.id), [rigs, selected?.id]);

  if (!selected) return <Panel>暂无网箱，请新建。<Btn variant="primary" onClick={() => { const c = emptyCage(cages); saveCage(c); setSelectedId(c.id); }}>新建网箱</Btn></Panel>;

  const setCage = (patch: Partial<Cage>) => saveCage({ ...selected, ...patch });

  return (
    <div className="page-grid cages-page">
      <Panel title="网箱按口建档" extra={<Btn variant="primary" onClick={() => { const c = emptyCage(cages); saveCage(c); setSelectedId(c.id); }}>＋ 新建网箱</Btn>} className="cage-list-panel">
        <div className="cage-list">
          {cages.map((c) => {
            const count = rigs.filter((r) => r.cageId === c.id).length;
            return (
              <button key={c.id} className={`cage-item ${c.id === selected.id ? 'active' : ''}`} onClick={() => setSelectedId(c.id)}>
                <div><strong>{c.code}</strong><span>{c.name}</span></div>
                <div className="cage-meta"><Badge tone={count ? 'good' : 'warn'}>{count} 组双目</Badge><span>周长 {c.perimeterM}m</span></div>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="cage-detail">
        <Panel title={`网箱档案 · ${selected.code}`} extra={<Btn variant="danger" onClick={() => { if (confirm(`删除 ${selected.name} 及其相机配置？历史测量保留。`)) deleteCage(selected.id); }}>删除网箱</Btn>}>
          <div className="form-grid">
            <Field label="编号"><input value={selected.code} onChange={(e) => setCage({ code: e.target.value })} /></Field>
            <Field label="名称"><input value={selected.name} onChange={(e) => setCage({ name: e.target.value })} /></Field>
            <Field label="周长 m"><input type="number" step="0.1" value={selected.perimeterM} onChange={(e) => setCage({ perimeterM: +e.target.value })} /></Field>
            <Field label="网深 m"><input type="number" step="0.1" value={selected.netDepthM} onChange={(e) => setCage({ netDepthM: +e.target.value })} /></Field>
            <Field label="放苗日期"><input type="date" value={selected.stockingDate} onChange={(e) => setCage({ stockingDate: e.target.value })} /></Field>
            <Field label="苗种"><input value={selected.species} onChange={(e) => setCage({ species: e.target.value })} /></Field>
            <Field label="放苗尾数"><input type="number" value={selected.stockCount} onChange={(e) => setCage({ stockCount: +e.target.value })} /></Field>
            <Field label="预估成活率" hint="0–1，用于存鱼量和投喂量"><input type="number" min="0" max="1" step="0.01" value={selected.survivalRate} onChange={(e) => setCage({ survivalRate: +e.target.value })} /></Field>
          </div>
        </Panel>

        <Panel title={`双目相机安装档案（${cageRigs.length}/2）`} extra={<Btn variant="primary" disabled={cageRigs.length >= 2} onClick={() => saveRig(emptyRig(selected.id, cageRigs.length))}>＋ 挂一台双目</Btn>}>
          <div className="rig-grid">
            {cageRigs.map((rig) => {
              const cal = calibrations.find((c) => c.id === rig.activeCalibrationId);
              return <RigEditor key={rig.id} rig={rig} calName={cal ? `${cal.createdAt.slice(0, 10)} · RMS ${cal.rmsPx.toFixed(2)}px` : '未应用新标定，使用出厂参数'} onSave={saveRig} onDelete={() => deleteRig(rig.id)} />;
            })}
            {!cageRigs.length && <div className="empty">这口箱还没有相机。每口箱可挂 1–2 台双目相机；两台时即为四路画面。</div>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function RigEditor({ rig, calName, onSave, onDelete }: { rig: CameraRig; calName: string; onSave: (r: CameraRig) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState<CameraRig>(rig);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rig);
  const set = (patch: Partial<CameraRig>) => setDraft((d) => ({ ...d, ...patch }));
  const setGlass = (patch: Partial<CameraRig['glass']>) => setDraft((d) => ({ ...d, glass: { ...d.glass, ...patch } }));
  return (
    <div className="rig-editor">
      <div className="rig-title">
        <strong><input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></strong>
        <Badge tone={rig.activeCalibrationId ? 'good' : 'warn'}>{calName}</Badge>
        <Btn size="sm" variant="danger" onClick={() => confirm('删除这台双目相机？') && onDelete()}>删除</Btn>
      </div>
      <div className="form-grid compact">
        <Field label="安装深度 m"><input type="number" step="0.1" value={draft.installDepthM} onChange={(e) => set({ installDepthM: +e.target.value })} /></Field>
        <Field label="安装方位 °"><input type="number" value={draft.mountAzimuthDeg} onChange={(e) => set({ mountAzimuthDeg: +e.target.value })} /></Field>
        <Field label="航向偏航 °"><input type="number" value={draft.yawDeg} onChange={(e) => set({ yawDeg: +e.target.value })} /></Field>
        <Field label="俯角 °"><input type="number" value={draft.pitchDeg} onChange={(e) => set({ pitchDeg: +e.target.value })} /></Field>
        <Field label="横滚 °"><input type="number" value={draft.rollDeg} onChange={(e) => set({ rollDeg: +e.target.value })} /></Field>
        <Field label="基线 mm"><input type="number" value={draft.baselineMm} onChange={(e) => set({ baselineMm: +e.target.value })} /></Field>
        <Field label="焦距 mm"><input type="number" step="0.1" value={draft.focalLengthMm} onChange={(e) => set({ focalLengthMm: +e.target.value })} /></Field>
        <Field label="传感器宽 mm"><input type="number" step="0.1" value={draft.sensorWidthMm} onChange={(e) => set({ sensorWidthMm: +e.target.value })} /></Field>
      </div>
      <details>
        <summary>玻璃罩折射与故意偏差</summary>
        <div className="form-grid compact">
          <Field label="玻璃折射"><input type="checkbox" checked={draft.glass.enabled} onChange={(e) => setGlass({ enabled: e.target.checked })} /></Field>
          <Field label="空气隙 m"><input type="number" step="0.001" value={draft.glass.airGapM} onChange={(e) => setGlass({ airGapM: +e.target.value })} /></Field>
          <Field label="玻璃厚 m"><input type="number" step="0.001" value={draft.glass.thicknessM} onChange={(e) => setGlass({ thicknessM: +e.target.value })} /></Field>
          <Field label="玻璃折射率"><input type="number" step="0.01" value={draft.glass.iorGlass} onChange={(e) => setGlass({ iorGlass: +e.target.value })} /></Field>
          <Field label="水折射率"><input type="number" step="0.001" value={draft.glass.iorWater} onChange={(e) => setGlass({ iorWater: +e.target.value })} /></Field>
          <Field label="基线偏差 %" hint="负值会让测量系统偏小"><input type="number" step="0.1" value={draft.bias.baselinePct} onChange={(e) => set({ bias: { ...draft.bias, baselinePct: +e.target.value } })} /></Field>
          <Field label="焦距偏差 %"><input type="number" step="0.1" value={draft.bias.focalPct} onChange={(e) => set({ bias: { ...draft.bias, focalPct: +e.target.value } })} /></Field>
          <Field label="k1 附加偏差"><input type="number" step="0.005" value={draft.bias.k1} onChange={(e) => set({ bias: { ...draft.bias, k1: +e.target.value } })} /></Field>
        </div>
      </details>
      <div className="rig-actions">
        <Btn size="sm" variant={dirty ? 'primary' : 'ghost'} disabled={!dirty} onClick={() => onSave(draft)}>{dirty ? '保存相机参数' : '已保存'}</Btn>
        <Btn size="sm" onClick={() => setDraft(rig)} disabled={!dirty}>还原</Btn>
      </div>
    </div>
  );
}
