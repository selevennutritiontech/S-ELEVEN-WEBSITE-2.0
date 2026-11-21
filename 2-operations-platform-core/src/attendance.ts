import { localYmd, zonedToUtc } from './reminders.js';
export interface Schedule { start: string; end: string; lunchMinutes: number; standardMinutes: number; lunchMinSpanMinutes: number; timezone: string; weeklyOff: number[] }
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return { h, m }; };
export const isoDate = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const localIso = (t: Date, tz: string) => { const p = localYmd(t, tz); return isoDate(p.y, p.m, p.d); };
/** One shift. Lunch is deducted ONCE from the attendance span (only when the span is long enough to include a lunch break). Overtime = net time above the standard 8 hours. */
export function computeDay(clockIn: Date, clockOut: Date | null, s: Schedule) {
  const { y, m, d } = localYmd(clockIn, s.timezone), a = hm(s.start), b = hm(s.end), schedStart = zonedToUtc(y, m, d, a.h, a.m, s.timezone), schedEnd = zonedToUtc(y, m, d, b.h, b.m, s.timezone);
  const late = Math.max(0, Math.round((clockIn.getTime() - schedStart.getTime()) / 60000));
  if (!clockOut) return { open: true as const, lateMinutes: late, spanMinutes: 0, lunchMinutes: 0, netMinutes: 0, overtimeMinutes: 0, earlyMinutes: 0 };
  const span = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000), lunch = span >= s.lunchMinSpanMinutes ? s.lunchMinutes : 0, net = Math.max(0, span - lunch);
  return { open: false as const, spanMinutes: span, lunchMinutes: lunch, netMinutes: net, overtimeMinutes: Math.max(0, net - s.standardMinutes), lateMinutes: late, earlyMinutes: Math.max(0, Math.round((schedEnd.getTime() - clockOut.getTime()) / 60000)) };
}
export interface Leave { from: string; to: string; type: string; paid: boolean; half: boolean }
export function monthReport(a: { year: number; month: number; schedule: Schedule; sessions: { in: Date; out: Date | null }[]; holidays: Record<string, string>; leaves: Leave[]; todayIso: string }) {
  const { year, month, schedule: s } = a, days = new Date(Date.UTC(year, month, 0)).getUTCDate(), rows: any[] = [];
  const sum = { present: 0, absent: 0, leaveDays: 0, holidays: 0, lateCount: 0, earlyCount: 0, netMinutes: 0, overtimeMinutes: 0 };
  for (let d = 1; d <= days; d++) {
    const iso = isoDate(year, month, d), wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay(), ss = a.sessions.filter(x => localIso(x.in, s.timezone) === iso).sort((x, y) => x.in.getTime() - y.in.getTime());
    const leave = a.leaves.find(l => iso >= l.from && iso <= l.to); let net = 0, ot = 0, late = 0, early = 0;
    ss.forEach((x, i) => { const r = computeDay(x.in, x.out, s); net += r.netMinutes; ot += r.overtimeMinutes; if (i === 0) late = r.lateMinutes; if (i === ss.length - 1) early = r.earlyMinutes; });
    let status: string;
    if (a.holidays[iso]) status = 'HOLIDAY'; else if (leave) status = leave.half ? 'HALF_DAY_LEAVE' : 'LEAVE'; else if (ss.length) status = 'PRESENT'; else if (s.weeklyOff.includes(wd)) status = 'WEEKLY_OFF'; else if (iso > a.todayIso) status = 'UPCOMING'; else status = 'ABSENT';
    if (status === 'PRESENT' || status === 'HALF_DAY_LEAVE') sum.present += status === 'PRESENT' ? 1 : 0.5; if (status === 'ABSENT') sum.absent++; if (status === 'HOLIDAY') sum.holidays++;
    if (leave) sum.leaveDays += leave.half ? 0.5 : 1; if (ss.length && late > 0) sum.lateCount++; if (ss.length && early > 0 && ss[ss.length - 1].out) sum.earlyCount++; sum.netMinutes += net; sum.overtimeMinutes += ot;
    rows.push({ date: iso, status, holiday: a.holidays[iso] ?? null, leaveType: leave?.type ?? null, netMinutes: net, overtimeMinutes: ot, lateMinutes: late, earlyMinutes: early, clockIn: ss[0]?.in ?? null, clockOut: ss.length ? ss[ss.length - 1].out : null });
  }
  return { rows, summary: sum };
}
