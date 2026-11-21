# Operations: backups, recovery, monitoring, performance targets

## Backups and restore (TESTED)
- `scripts/restore-drill.sh` dumps the database, restores it into a scratch database and compares the row count of every table. It was run against a database holding
  600 orders, 600 payments and their ledgers and passed. Run it on a schedule (weekly) and after every migration in staging.
- Production: enable the managed-database daily snapshots plus point-in-time recovery (WAL archiving), keep 30 days, store a monthly copy in a second region, and test a restore every quarter.
- Migrations are forward-only SQL files (`db/migrations/*.sql`) applied in a transaction by `npm run db:migrate`; take a snapshot first. Existing data is never reset.

## Recovering stuck records (run as a Finance/Host operator)
- Paid money, order not progressed: `SELECT o.order_number FROM orders o JOIN payment_captures c ON c.order_id=o.id WHERE o.status='PENDING_PAYMENT';` (the dashboard flags these as "late capture, review").
- Reservations with no live order: `SELECT * FROM inventory_reservations r JOIN orders o ON o.id=r.order_id WHERE r.status='ACTIVE' AND o.status IN ('EXPIRED','CANCELLED');` (should always be empty; `expireOrders` releases them idempotently).
- Missing clock-outs: flagged to the Host by `flagMissingClockOuts`; correct them through an approved attendance correction.
- Every scheduled job (`expireOrders`, `syncPreorders`, `runReminderTick`, `runPendingWorkTick`, `preorderReminderTick`, `flagMissingClockOuts`) is idempotent: re-running after an outage is safe.

## Monitoring checklist (to wire up when the API layer exists)
Health endpoint (db + queue), structured request logs, p50/p95/p99 per route, DB connections and slow queries (>200 ms), queue depth and age of the oldest job, failed/dead-lettered jobs,
payment webhook failures, count of orders in PENDING_PAYMENT past expiry, negative-inventory discrepancies, unresolved packing discrepancies, error tracking.

## Performance objectives (initial targets from the brief) and what has been measured
Targets: common reads p95 < 500 ms; standard writes p95 < 800 ms; dashboard summaries p95 < 1 s; zero duplicate financial effects; zero overselling.
Measured on the DEVELOPMENT machine (`npm run loadtest`, local PostgreSQL, 25 connections, no network): create order p95 ~0.3 s at ~220/s; payment (initiate + webhook) p95 ~0.4 s at ~140/s;
dealer history page p95 ~60 ms; 600 replayed webhooks changed nothing; 0 integrity violations. These numbers are NOT a production capacity claim: repeat on production-like infrastructure with real network latency before launch.
