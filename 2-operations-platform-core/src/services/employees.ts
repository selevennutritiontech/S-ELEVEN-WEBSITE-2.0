import type pg from 'pg';
import { timingSafeEqual } from 'node:crypto';
import { tx, DomainError } from '../db.js';
import { assertCan, type Actor } from '../permissions.js';
/** The Host role can NOT be created or assigned through employee management. The rule lives in the database trigger too, so it cannot be bypassed by crafting an API request. */
const HOSTISH = /^\s*(host|super[\s_-]*admin)\s*$/i;
function mapPg(e: any): never {
  const m = String(e?.message ?? ''); if (m.startsWith('HOST_PROVISIONING_RESTRICTED')) throw new DomainError('HOST_NOT_ASSIGNABLE', 'The Host role cannot be created or assigned through employee management');
  if (m.startsWith('LAST_SUPER_ADMIN')) throw new DomainError('LAST_SUPER_ADMIN', 'The last active Host cannot be removed or deactivated. Use the secure recovery procedure.'); throw e;
}
async function dept(c: pg.PoolClient, name: string) { const r = (await c.query('SELECT id FROM departments WHERE upper(code)=upper($1)', [name.trim()])).rows[0]; if (!r) throw new DomainError('UNKNOWN_DEPARTMENT', 'Unknown department'); return r.id as number; }
export async function createEmployee(pool: pg.Pool, actor: Actor, a: { code: string; name: string; email: string; department: string; designation?: string; mobile?: string; managerId?: string }) {
  assertCan(actor, 'employee.create');
  if (HOSTISH.test(a.department) || HOSTISH.test(a.designation ?? '')) throw new DomainError('HOST_NOT_ASSIGNABLE', 'The Host role cannot be created or assigned through employee management');
  return tx(pool, async c => {
    await c.query("SELECT set_config('app.actor_id', $1, true)", [actor.id]);
    const id = (await c.query("INSERT INTO employees (employee_code, name, email, mobile, department_id, designation, manager_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE') RETURNING id", [a.code, a.name, a.email, a.mobile ?? null, await dept(c, a.department), a.designation ?? null, a.managerId ?? null])).rows[0].id as string;
    await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, after) VALUES ('EMPLOYEE',$1,'EMPLOYEE_CREATED','employee',$2,$3)", [actor.id, id, JSON.stringify({ code: a.code, department: a.department })]); return id;
  }).catch(mapPg);
}
export async function changeDepartment(pool: pg.Pool, actor: Actor, employeeId: string, department: string) {
  assertCan(actor, 'employee.create'); if (HOSTISH.test(department)) throw new DomainError('HOST_NOT_ASSIGNABLE', 'The Host role cannot be created or assigned through employee management');
  await tx(pool, async c => { await c.query("SELECT set_config('app.actor_id', $1, true)", [actor.id]); await c.query('UPDATE employees SET department_id=$2 WHERE id=$1', [employeeId, await dept(c, department)]);
    await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, after) VALUES ('EMPLOYEE',$1,'DEPARTMENT_CHANGED','employee',$2,$3)", [actor.id, employeeId, JSON.stringify({ department })]); }).catch(mapPg);
}
export async function setEmployeeStatus(pool: pg.Pool, actor: Actor, employeeId: string, status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE') {
  assertCan(actor, 'employee.create');
  await tx(pool, async c => { await c.query("SELECT set_config('app.actor_id', $1, true)", [actor.id]); await c.query('UPDATE employees SET status=$2 WHERE id=$1', [employeeId, status]);
    await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, after) VALUES ('EMPLOYEE',$1,'STATUS_CHANGED','employee',$2,$3)", [actor.id, employeeId, JSON.stringify({ status })]); }).catch(mapPg);
}
/** First Host of a new installation. Refused once any Host exists. */
export async function bootstrapFirstHost(pool: pg.Pool, a: { code: string; name: string; email: string }) {
  return tx(pool, async c => { await c.query('LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE'); if ((await c.query("SELECT 1 FROM employees e JOIN departments d ON d.id=e.department_id WHERE d.code='HOST'")).rowCount) throw new DomainError('HOST_EXISTS', 'A Host already exists');
    return (await c.query("INSERT INTO employees (employee_code, name, email, department_id, status) VALUES ($1,$2,$3,(SELECT id FROM departments WHERE code='HOST'),'ACTIVE') RETURNING id", [a.code, a.name, a.email])).rows[0].id as string; });
}
/** The ONLY way to add another super-administrator: an existing Host plus an out-of-band token that operations sets in the environment (never hard-coded, never in the UI). */
export async function provisionSuperAdmin(pool: pg.Pool, actor: Actor, a: { code: string; name: string; email: string; confirmToken: string }) {
  if (actor.role !== 'HOST') throw new DomainError('FORBIDDEN', 'Only an existing Host can start this procedure');
  const want = process.env.SUPER_ADMIN_PROVISION_TOKEN ?? ''; const got = Buffer.from(a.confirmToken ?? ''), exp = Buffer.from(want);
  if (!want || got.length !== exp.length || !timingSafeEqual(got, exp)) throw new DomainError('FORBIDDEN', 'Super-administrator provisioning is not authorised');
  return tx(pool, async c => { await c.query("SELECT set_config('app.host_provisioning','on',true)"); await c.query("SELECT set_config('app.actor_id', $1, true)", [actor.id]);
    const id = (await c.query("INSERT INTO employees (employee_code, name, email, department_id, status) VALUES ($1,$2,$3,(SELECT id FROM departments WHERE code='HOST'),'ACTIVE') RETURNING id", [a.code, a.name, a.email])).rows[0].id as string;
    await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id) VALUES ('EMPLOYEE',$1,'SUPER_ADMIN_PROVISIONED','employee',$2)", [actor.id, id]); return id; }).catch(mapPg);
}
