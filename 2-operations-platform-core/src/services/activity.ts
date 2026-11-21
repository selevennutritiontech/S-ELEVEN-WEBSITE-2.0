import type pg from 'pg';
/** Records an employee action and notifies the Host (the Host's own actions are recorded but not notified). */
export async function recordActivity(db: pg.Pool | pg.PoolClient, a: { actorId: string; action: string; detail?: string; kind?: string }) {
  await db.query('INSERT INTO activity_events (actor_id, action, detail, kind) VALUES ($1,$2,$3,$4)', [a.actorId, a.action, a.detail ?? null, a.kind ?? 'action']);
  const dept = (await db.query('SELECT d.code FROM employees e JOIN departments d ON d.id=e.department_id WHERE e.id=$1', [a.actorId])).rows[0]?.code;
  if (dept !== 'HOST') await db.query("INSERT INTO notifications (kind, recipient_department, payload) VALUES ('EMPLOYEE_ACTION','HOST',$1)", [JSON.stringify({ actorId: a.actorId, action: a.action, detail: a.detail ?? '', kind: a.kind ?? 'action' })]);
}
