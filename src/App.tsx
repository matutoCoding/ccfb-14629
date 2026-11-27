import { useState } from 'react';
import { AppDataProvider, useAppData } from './state/AppDataContext';
import { CagesPage } from './pages/CagesPage';
import { CalibrationPage } from './pages/CalibrationPage';
import { StereoPage } from './pages/StereoPage';
import { RecordsPage } from './pages/RecordsPage';
import { GrowthPage } from './pages/GrowthPage';
import { SettingsPage } from './pages/SettingsPage';
import { fmtInt } from './lib/format';

type Page = 'cages' | 'calibration' | 'stereo' | 'records' | 'growth' | 'settings';

const NAV: { id: Page; label: string; icon: string; desc: string }[] = [
  { id: 'cages', label: '网箱档案', icon: '▦', desc: '网箱与相机安装' },
  { id: 'calibration', label: '相机标定', icon: '◎', desc: '棋盘格解算/剔除' },
  { id: 'stereo', label: '双目画面', icon: '◉', desc: '四路仿真与测量' },
  { id: 'records', label: '测量记录', icon: '▤', desc: '对账与导出' },
  { id: 'growth', label: '生长分析', icon: '∿', desc: '分布/ADG/投喂' },
  { id: 'settings', label: '设置', icon: '⚙', desc: '系数与精度自检' },
];

function Shell() {
  const [page, setPage] = useState<Page>('stereo');
  const { loading, settings, measurements, dataError } = useAppData();
  if (dataError && !settings) {
    return (
      <div className="app-loading error-screen">
        <div className="logo">!</div>
        <h2>浏览器本地数据库未能启动</h2>
        <p>{dataError}</p>
        <p className="hint">请允许 IndexedDB/本地存储，或使用正常浏览器窗口（隐私模式可能限制存储）。</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>重试</button>
      </div>
    );
  }
  if (loading || !settings) return <div className="app-loading"><div className="logo">黄鱼测</div><p>正在打开 IndexedDB 并装载仿真网箱…</p></div>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">鱼</div>
          <div><strong>网箱双目测鱼</strong><span>Offshore Stereo Fish</span></div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => setPage(n.id)}>
              <i>{n.icon}</i><span><b>{n.label}</b><em>{n.desc}</em></span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          <div><b>仿真链路已就绪</b><em>WebGPU + IndexedDB</em></div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <h1>{NAV.find((n) => n.id === page)?.label}</h1>
            <p>大黄鱼深水网箱 · 仿真画面先行，真相机可替换采集源</p>
          </div>
          <div className="top-meta">
            <span>记录 {fmtInt(measurements.length)} 条</span>
            <span>季节 {({ spring: '春', summer: '夏', autumn: '秋', winter: '冬' } as const)[settings.season]}</span>
            <span>水温 {settings.waterTempC.toFixed(1)}℃</span>
          </div>
        </header>
        <div className="page-content">
          {page === 'cages' && <CagesPage />}
          {page === 'calibration' && <CalibrationPage />}
          {page === 'stereo' && <StereoPage />}
          {page === 'records' && <RecordsPage />}
          {page === 'growth' && <GrowthPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return <AppDataProvider><Shell /></AppDataProvider>;
}
