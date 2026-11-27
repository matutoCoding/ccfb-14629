import { useMemo, useState } from 'react';
import { useAppData } from '../state/AppDataContext';
import { Panel, Btn, Badge, Stat } from '../components/ui';
import { accuracySummary } from '../lib/growth';
import { fmtDateTimeShort } from '../lib/format';

export function RecordsPage() {
  const { measurements, cages, rigs, deleteMeasurement } = useAppData();
  const [cageId, setCageId] = useState('all');
  const [method, setMethod] = useState('all');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => measurements.filter((r) =>
    (cageId === 'all' || r.cageId === cageId) &&
    (method === 'all' || r.method === method) &&
    (!query || r.truthFishId?.includes(query) || r.id.includes(query)),
  ), [measurements, cageId, method, query]);

  const summary = accuracySummary(rows);
  const cageName = (id: string) => cages.find((c) => c.id === id)?.code ?? id;
  const rigName = (id: string) => rigs.find((r) => r.id === id)?.name ?? id;

  function exportCsv() {
    const header = ['时间', '网箱', '相机', '方式', '叉长mm', '体重g', '可信度', '真值mm', '误差mm', '误差%', '重投影px', '极线px', '斜角°', '遮挡%', '偏差参数'];
    const lines = rows.map((r) => [
      r.measuredAt, cageName(r.cageId), rigName(r.rigId), r.method, r.forkLengthMm.toFixed(2), r.weightG.toFixed(1),
      r.confidence.toFixed(3), r.trueLengthMm?.toFixed(2) ?? '', r.errorMm?.toFixed(2) ?? '', r.errorPct?.toFixed(3) ?? '',
      r.reprojErrorPx.toFixed(3), r.epipolarErrorPx.toFixed(3), r.obliqueDeg.toFixed(1), r.occlusionPct.toFixed(1), r.biased ? 'yes' : 'no',
    ].join(','));
    const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fish-measurements-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="page-stack">
      <div className="stats-grid">
        <Stat label="记录总数" value={rows.length} unit="条" />
        <Stat label="平均叉长" value={rows.length ? (rows.reduce((a, r) => a + r.forkLengthMm, 0) / rows.length).toFixed(1) : '—'} unit="mm" />
        <Stat label="平均体重" value={rows.length ? (rows.reduce((a, r) => a + r.weightG, 0) / rows.length).toFixed(0) : '—'} unit="g" />
        <Stat label="对账 MAPE" value={summary.count ? summary.mape.toFixed(2) : '—'} unit="%" tone={summary.mape <= 2 ? 'good' : 'bad'} />
        <Stat label="平均系统偏差" value={summary.count ? summary.bias.toFixed(2) : '—'} unit="%" tone={Math.abs(summary.bias) <= 2 ? 'good' : 'bad'} />
      </div>
      <Panel title="测量记录" extra={<Btn variant="primary" onClick={exportCsv} disabled={!rows.length}>导出 CSV</Btn>}>
        <div className="filters">
          <select value={cageId} onChange={(e) => setCageId(e.target.value)}>
            <option value="all">全部网箱</option>
            {cages.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="all">手动/自动</option>
            <option value="auto">自动</option>
            <option value="manual">手动</option>
          </select>
          <input placeholder="搜索鱼ID/记录ID" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Badge tone="muted">数据持久化在 IndexedDB</Badge>
        </div>
        <div className="table-scroll">
          <table className="data-table dense">
            <thead><tr>
              <th>时间</th><th>网箱</th><th>方式</th><th>叉长 mm</th><th>体重 g</th><th>可信度</th>
              <th>真值 mm</th><th>误差%</th><th>重投影</th><th>极线</th><th>斜角</th><th>遮挡</th><th></th>
            </tr></thead>
            <tbody>
              {rows.slice(0, 300).map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTimeShort(r.measuredAt)}</td>
                  <td>{cageName(r.cageId)}</td>
                  <td>{r.method === 'auto' ? <Badge tone="accent">自动</Badge> : <Badge>手动</Badge>}{r.biased && <Badge tone="bad">偏参</Badge>}</td>
                  <td className="num strong">{r.forkLengthMm.toFixed(1)}</td>
                  <td className="num">{r.weightG.toFixed(0)}</td>
                  <td className="num">{r.confidence.toFixed(2)}</td>
                  <td className="num">{r.trueLengthMm?.toFixed(1) ?? '—'}</td>
                  <td className={`num ${Math.abs(r.errorPct ?? 0) <= 2 ? 'good' : 'bad'}`}>{r.errorPct != null ? `${r.errorPct >= 0 ? '+' : ''}${r.errorPct.toFixed(2)}` : '—'}</td>
                  <td className="num">{r.reprojErrorPx.toFixed(2)}px</td>
                  <td className="num">{r.epipolarErrorPx.toFixed(2)}px</td>
                  <td className="num">{r.obliqueDeg.toFixed(0)}°</td>
                  <td className="num">{r.occlusionPct.toFixed(0)}%</td>
                  <td><Btn size="sm" variant="danger" onClick={() => confirm('删除这条记录？') && deleteMeasurement(r.id)}>删</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">没有符合条件的记录。</div>}
          {rows.length > 300 && <p className="hint">仅显示前 300 条；CSV 会导出当前筛选的全部 {rows.length} 条。</p>}
        </div>
      </Panel>
    </div>
  );
}
