import { useMemo, useState } from 'react';
import { useAppData } from '../state/AppDataContext';
import { Panel, Stat, Btn, Field, Badge } from '../components/ui';
import { HistogramChart, LineChart, type LineSeries } from '../components/Charts';
import { daysToMarket, feedRecommendation, histogram, weightFromLength } from '../lib/growth';
import { fmtInt, fmtMonthDay } from '../lib/format';

export function GrowthPage() {
  const { cages, measurements, settings, updateSettings } = useAppData();
  const [cageId, setCageId] = useState(settings?.activeCageId ?? cages[0]?.id ?? '');
  const [rangeDays, setRangeDays] = useState(21);
  const cage = cages.find((c) => c.id === cageId) ?? cages[0];
  const cageRecords = useMemo(
    () => measurements.filter((r) => r.cageId === cage?.id),
    [measurements, cage?.id],
  );
  const byDate = useMemo(() => {
    const map = new Map<string, { t: number; lengths: number[]; weights: number[] }>();
    cageRecords.forEach((r) => {
      const day = r.measuredAt.slice(0, 10);
      if (!map.has(day)) map.set(day, { t: +new Date(day), lengths: [], weights: [] });
      const g = map.get(day)!;
      g.t = +new Date(day);
      g.lengths.push(r.forkLengthMm);
      g.weights.push(r.weightG);
    });
    return [...map.values()].sort((a, b) => a.t - b.t);
  }, [cageRecords]);

  if (!settings || !cage) return <Panel>暂无数据</Panel>;

  const latestTs = cageRecords.length ? Math.max(...cageRecords.map((r) => +new Date(r.measuredAt))) : Date.now();
  const rangeRecords = cageRecords.filter((r) => latestTs - +new Date(r.measuredAt) <= rangeDays * 86400000);
  const distRecords = rangeRecords.length >= 8 ? rangeRecords : cageRecords;
  const bins = histogram(distRecords.map((r) => r.forkLengthMm), 12);
  const avgLength = distRecords.reduce((a, r) => a + r.forkLengthMm, 0) / Math.max(1, distRecords.length);
  const avgWeight = distRecords.reduce((a, r) => a + r.weightG, 0) / Math.max(1, distRecords.length);
  const market = daysToMarket(cageRecords, settings);
  const feed = feedRecommendation({
    stockCount: cage.stockCount,
    survivalRate: cage.survivalRate,
    avgWeightG: Number.isFinite(avgWeight) ? avgWeight : 350,
    tempC: settings.waterTempC,
    settings,
  });

  const lengthSeries: LineSeries[] = [{
    name: '平均叉长 mm', color: '#38bdf8',
    points: byDate.map((d) => ({ x: d.t, y: d.lengths.reduce((a, b) => a + b, 0) / d.lengths.length, label: `${fmtMonthDay(d.t)} · n=${d.lengths.length}` })),
  }];
  const weightSeries: LineSeries[] = [{
    name: '平均体重 g', color: '#fbbf24',
    points: byDate.map((d) => ({ x: d.t, y: d.weights.reduce((a, b) => a + b, 0) / d.weights.length, label: `${fmtMonthDay(d.t)} · n=${d.weights.length}` })),
  }];
  const forecastT = market.daysWeight != null ? Date.now() + market.daysWeight * 86400000 : null;
  if (forecastT != null && market.currentWeightG > 0) {
    weightSeries.push({
      name: '上市规格预测', color: '#f87171', dashed: true,
      points: [
        { x: Date.now(), y: market.currentWeightG },
        { x: forecastT, y: settings.marketWeightG },
      ],
    });
  }

  const sampleEnough = distRecords.length >= 30;
  const tempStatus = settings.waterTempC < 16 ? '低温减量' : settings.waterTempC > 28 ? '高温控料' : '适温投喂';

  return (
    <div className="page-stack">
      <Panel title="生长分析网箱选择">
        <div className="controls-row">
          <select value={cage.id} onChange={(e) => setCageId(e.target.value)}>
            {cages.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
          <div className="segmented">
            {[7, 21, 42, 9999].map((d) => <button key={d} className={rangeDays === d ? 'active' : ''} onClick={() => setRangeDays(d)}>{d === 9999 ? '全部' : `近${d}天`}</button>)}
          </div>
          <Badge tone={sampleEnough ? 'good' : 'warn'}>{sampleEnough ? `样本量 ${distRecords.length}，分布可参考` : `样本仅 ${distRecords.length} 条，建议 ≥30 条再估算分布`}</Badge>
        </div>
      </Panel>

      <div className="stats-grid">
        <Stat label="当前平均叉长" value={Number.isFinite(avgLength) ? avgLength.toFixed(1) : '—'} unit="mm" hint={`样本 ${distRecords.length} 条`} />
        <Stat label="当前平均体重" value={Number.isFinite(avgWeight) ? avgWeight.toFixed(0) : '—'} unit="g" tone="accent" hint={`${settings.season === 'autumn' ? '秋季肥满系数较高' : '按当前季节 L-W'}`} />
        <Stat label="日增重 ADG" value={market.adgG ? market.adgG.toFixed(1) : '—'} unit="g/天" tone="good" />
        <Stat label={`达 ${settings.marketWeightG}g 还需`} value={market.daysWeight != null ? Math.ceil(market.daysWeight) : '数据不足'} unit={market.daysWeight != null ? '天' : ''} tone={market.daysWeight != null && market.daysWeight < 30 ? 'good' : 'warn'} />
        <Stat label={`达 ${settings.marketLengthMm}mm 还需`} value={market.daysLength != null ? Math.ceil(market.daysLength) : '数据不足'} unit={market.daysLength != null ? '天' : ''} />
      </div>

      <div className="two-col">
        <Panel title="叉长分布直方图" extra={<Badge>近 {rangeDays === 9999 ? '全部' : `${rangeDays} 天`}{rangeRecords.length < 8 ? '，样本不足已扩大到全部' : ''}</Badge>}>
          {bins.length ? <HistogramChart bins={bins} marker={avgLength} /> : <div className="empty">还没有测量数据。</div>}
          <p className="hint">体重换算：W = {settings.lengthWeight[settings.season].a} × L(cm)^{settings.lengthWeight[settings.season].b}，季节系数可在“设置”调整。</p>
        </Panel>

        <Panel title="存鱼量与投喂推荐" extra={<Badge tone={settings.waterTempC >= 16 && settings.waterTempC <= 28 ? 'good' : 'warn'}>{tempStatus}</Badge>}>
          <div className="feed-grid">
            <Field label="水温 ℃"><input type="number" step="0.1" value={settings.waterTempC} onChange={(e) => updateSettings({ ...settings, waterTempC: +e.target.value })} /></Field>
            <Stat label="估算存鱼" value={fmtInt(Math.round(cage.stockCount * cage.survivalRate))} unit="尾" />
            <Stat label="生物量" value={feed.biomassKg.toFixed(0)} unit="kg" />
            <Stat label="推荐投饵率" value={feed.ratePct.toFixed(2)} unit="%/天" tone="accent" />
            <Stat label="日投喂量" value={feed.feedKgDay.toFixed(1)} unit="kg/天" tone="good" />
          </div>
          <p className="formula">{feed.formula}</p>
          <p className="hint">水温曲线：20–26℃ 按基础投饵率；低于16℃或高于28℃自动减量。实际投喂还应结合残饵、流速和鱼群摄食状态。</p>
        </Panel>
      </div>

      <Panel title="生长曲线：每次测量按日期连成趋势">
        <LineChart series={lengthSeries} yLabel="叉长 mm" xLabel={(v) => fmtMonthDay(v)} />
      </Panel>
      <Panel title="体重增长与上市预测">
        <LineChart series={weightSeries} yLabel="体重 g" xLabel={(v) => fmtMonthDay(v)} />
      </Panel>
    </div>
  );
}
