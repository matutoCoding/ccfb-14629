import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Panel({ title, extra, children, className = '' }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <h2>{title}</h2>
          {extra}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'good' | 'warn'; size?: 'sm' | 'md' };
export function Btn({ variant = 'ghost', size = 'md', className = '', ...props }: BtnProps) {
  return <button {...props} className={`btn btn-${variant} btn-${size} ${className}`} />;
}

export function Stat({ label, value, unit, tone, hint }: { label: string; value: ReactNode; unit?: string; tone?: 'good' | 'bad' | 'warn' | 'accent'; hint?: ReactNode }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}{unit && <span className="unit">{unit}</span>}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: 'good' | 'bad' | 'warn' | 'accent' | 'muted'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <em>{hint}</em>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <header><h3>{title}</h3><Btn size="sm" onClick={onClose}>关闭</Btn></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ text = '计算中…' }: { text?: string }) {
  return <span className="spinner"><i />{text}</span>;
}
