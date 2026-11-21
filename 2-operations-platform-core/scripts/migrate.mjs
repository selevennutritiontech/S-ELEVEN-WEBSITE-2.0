import pg from 'pg'; import fs from 'node:fs'; import path from 'node:path';
const url = process.env.DATABASE_URL || 'postgres://seleven:seleven@localhost:5432/seleven_test';
const c = new pg.Client({ connectionString: url }); await c.connect();
await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
const dir = new URL('../db/migrations/', import.meta.url).pathname;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
  const done = await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]); if (done.rowCount) { console.log('skip', f); continue; }
  await c.query('BEGIN'); try { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]); await c.query('COMMIT'); console.log('applied', f); } catch (e) { await c.query('ROLLBACK'); throw e; }
}
await c.end();
