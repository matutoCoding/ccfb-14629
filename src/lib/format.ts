export function fmtInt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function fmtMonthDay(v: number | string | Date): string {
  const d = new Date(v);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDateTimeShort(v: string | number | Date): string {
  const d = new Date(v);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
