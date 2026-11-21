export const INTERVAL_MS = 15 * 60 * 1000;
/** Missing-invoice reminders: first at eligible+15 min, then every 15 min. The slot number makes each reminder idempotent. */
export function invoiceSlot(eligibleAt: Date, now: Date): number | null { const d = now.getTime() - eligibleAt.getTime(); return d < INTERVAL_MS ? null : Math.floor(d / INTERVAL_MS); }
function offsetMs(t: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi); let utc = guess - offsetMs(guess, tz); utc = guess - offsetMs(utc, tz); return new Date(utc);
}
export function localYmd(t: Date, tz: string) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t).map(x => [x.type, x.value])); return { y: +p.year, m: +p.month, d: +p.day }; }
/** Orders received on local day D get tracking reminders from 10:00 on day D+1 in the company timezone. */
export function trackingStart(receivedAt: Date, tz: string): Date { const { y, m, d } = localYmd(receivedAt, tz); return zonedToUtc(y, m, d + 1, 10, 0, tz); }
export function trackingSlot(start: Date, now: Date): number | null { const d = now.getTime() - start.getTime(); return d < 0 ? null : Math.floor(d / INTERVAL_MS); }
export function monthOf(t: Date, tz: string): string { const { y, m } = localYmd(t, tz); return `${y}-${String(m).padStart(2, '0')}-01`; }
