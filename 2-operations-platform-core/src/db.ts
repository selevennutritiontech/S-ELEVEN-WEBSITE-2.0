import pg from 'pg';
pg.types.setTypeParser(20, (v: string) => BigInt(v)); // int8 -> bigint (money is integer paise)
export type Q = pg.Pool | pg.PoolClient;
export function makePool(max = 25) { return new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://seleven:seleven@localhost:5432/seleven_test', max }); }
export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { try { await c.query('ROLLBACK'); } catch { /* ignore */ } throw e; }
  finally { c.release(); }
}
export class DomainError extends Error { constructor(public code: string, msg?: string, public details?: unknown) { super(msg || code); this.name = 'DomainError'; } }
/** Advisory lock shared by payment-capture transactions (shared) and warehouse shift closure (exclusive). */
export const LOCK_SHIFT = 7001;
export const TZ = 'Asia/Kolkata';
