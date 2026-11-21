import type pg from 'pg';
import { roundDiv } from '../money.js';
/** Reconciles payment records with the target ledger. Finance reports must tie to these numbers. */
export async function reconcile(pool: pg.Pool) {
  const caps = (await pool.query('SELECT COALESCE(SUM(amount_paise),0)::bigint AS s FROM payment_captures')).rows[0].s as bigint;
  const refs = (await pool.query('SELECT COALESCE(SUM(amount_paise),0)::bigint AS s FROM refunds')).rows[0].s as bigint;
  const ledger = (await pool.query('SELECT COALESCE(SUM(amount_paise),0)::bigint AS s FROM target_credit_ledger')).rows[0].s as bigint;
  // expected ledger = sum over captures/refunds of the eligible portion of each event, recomputed from immutable order snapshots
  const ev = (await pool.query(`SELECT c.amount_paise AS amt, 1 AS sign, o.total_paise AS total, (SELECT COALESCE(SUM(eligible_paise),0)::bigint FROM order_items WHERE order_id=o.id) AS e, o.sales_employee_id AS emp FROM payment_captures c JOIN orders o ON o.id=c.order_id
    UNION ALL SELECT r.amount_paise, -1, o.total_paise, (SELECT COALESCE(SUM(eligible_paise),0)::bigint FROM order_items WHERE order_id=o.id), o.sales_employee_id FROM refunds r JOIN orders o ON o.id=r.order_id`)).rows;
  let expected = 0n; for (const r of ev) if (r.emp) expected += BigInt(r.sign) * roundDiv((r.amt as bigint) * (r.e as bigint), r.total as bigint);
  const unpaidWithCapture = (await pool.query("SELECT count(*)::int AS n FROM orders o WHERE o.status='PENDING_PAYMENT' AND EXISTS (SELECT 1 FROM payment_captures c WHERE c.order_id=o.id)")).rows[0].n as number;
  return { capturedPaise: caps, refundedPaise: refs, netCollectedPaise: caps - refs, ledgerNetPaise: ledger, expectedLedgerPaise: expected, ledgerMatches: ledger === expected, unpaidOrdersWithCapture: unpaidWithCapture, ok: ledger === expected && unpaidWithCapture === 0 };
}
