import { useId } from 'react';

export function HistogramChart({ bins, height = 220, marker, color = '#38bdf8' }: {
  bins: { x0: number; x1: number; count: number }[];
  height?: number;
  marker?: number;
  color?: string;
}) {
  const width = 720;
  const pad = { l: 42, r: 14, t: 16, b: 34 };
  const max = Math.max(1, ...bins.map((b) => b.count));
  const xMin = bins[0]?.x0 ?? 0;
  const xMax = bins[bins.length - 1]?.x1 ?? 1;
  const x = (v: number) => pad.l + ((v - xMin) / Math.max(1, xMax - xMin)) * (width - pad.l - pad.r);
  const y = (c: number) => height - pad.b - (c / max) * (height - pad.t - pad.b);
  const ticks = 5;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const c = (max / ticks) * i;
        const yy = y(c);
        return <g key={i}><line x1={pad.l} x2={width - pad.r} y1={yy} y2={yy} className="grid-line" /><text x={pad.l - 7} y={yy + 4} textAnchor="end" className="axis-text">{c.toFixed(0)}</text></g>;
      })}
      {bins.map((b, i) => (
        <rect key={i} x={x(b.x0) + 1} width={Math.max(2, x(b.x1) - x(b.x0) - 2)} y={y(b.count)} height={height - pad.b - y(b.count)} fill={color} opacity={0.78} rx={3}>
          <title>{`${b.x0.toFixed(0)}-${b.x1.toFixed(0)} mm：${b.count} 条`}</title>
        </rect>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const v = xMin + t * (xMax - xMin);
        return <text key={t} x={x(v)} y={height - 12} textAnchor="middle" className="axis-text">{v.toFixed(0)}</text>;
      })}
      {marker !== undefined && marker >= xMin && marker <= xMax && (
        <g>
          <line x1={x(marker)} x2={x(marker)} y1={pad.t} y2={height - pad.b} stroke="#fbbf24" strokeWidth={2} strokeDasharray="5 4" />
          <text x={x(marker) + 5} y={pad.t + 12} className="marker-text">均值 {marker.toFixed(1)} mm</text>
        </g>
      )}
    </svg>
  );
}

export interface LineSeries {
  name: string;
  color: string;
  points: { x: number; y: number; label?: string }[];
  dashed?: boolean;
}

export function LineChart({ series, height = 280, yLabel, xLabel, yMin, yMax }: {
  series: LineSeries[];
  height?: number;
  yLabel?: string;
  xLabel?: (v: number) => string;
  yMin?: number;
  yMax?: number;
}) {
  const gid = useId().replace(/:/g, '');
  const width = 760;
  const pad = { l: 54, r: 18, t: 18, b: 42 };
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <div className="empty">样本不足，暂不能绘制趋势</div>;
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = yMin ?? Math.min(...ys) * 0.96;
  const ymax = yMax ?? Math.max(...ys) * 1.04;
  const X = (v: number) => pad.l + ((v - xmin) / Math.max(1e-6, xmax - xmin)) * (width - pad.l - pad.r);
  const Y = (v: number) => height - pad.b - ((v - ymin) / Math.max(1e-6, ymax - ymin)) * (height - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img">
      <defs><linearGradient id={`fill-${gid}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" /><stop offset="100%" stopColor="#38bdf8" stopOpacity="0" /></linearGradient></defs>
      {Array.from({ length: 6 }, (_, i) => {
        const v = ymin + ((ymax - ymin) / 5) * i;
        const yy = Y(v);
        return <g key={i}><line x1={pad.l} x2={width - pad.r} y1={yy} y2={yy} className="grid-line" /><text x={pad.l - 8} y={yy + 4} textAnchor="end" className="axis-text">{v.toFixed(0)}</text></g>;
      })}
      {series.map((s) => {
        const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
        const area = `${d} L${X(s.points[s.points.length - 1].x)},${height - pad.b} L${X(s.points[0].x)},${height - pad.b} Z`;
        return (
          <g key={s.name}>
            {!s.dashed && <path d={area} fill={`url(#fill-${gid})`} />}
            <path d={d} fill="none" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '7 5' : undefined} />
            {s.points.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={3.2} fill={s.color}><title>{p.label ?? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`}</title></circle>)}
          </g>
        );
      })}
      {Array.from({ length: 6 }, (_, i) => {
        const v = xmin + ((xmax - xmin) / 5) * i;
        return <text key={i} x={X(v)} y={height - 16} textAnchor="middle" className="axis-text">{xLabel ? xLabel(v) : v.toFixed(0)}</text>;
      })}
      {yLabel && <text x={14} y={20} className="axis-text">{yLabel}</text>}
      <g className="legend">
        {series.map((s, i) => <g key={s.name} transform={`translate(${pad.l + i * 150}, 14)`}><line x1="0" x2="24" y1="0" y2="0" stroke={s.color} strokeWidth={3} strokeDasharray={s.dashed ? '6 4' : undefined} /><text x={30} y={4} className="axis-text">{s.name}</text></g>)}
      </g>
    </svg>
  );
}

export function Bars({ items, height = 180 }: { items: { label: string; value: number; tone?: string }[]; height?: number }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bars" style={{ height }}>
      {items.map((it) => (
        <div className="bar-col" key={it.label} title={`${it.label}: ${it.value.toFixed(1)}`}>
          <div className="bar-value">{it.value.toFixed(0)}</div>
          <div className={`bar ${it.tone ?? ''}`} style={{ height: `${(it.value / max) * 72}%` }} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
