import type pg from 'pg';
import { tx, DomainError } from '../db.js';
import { assertCan, can, type Actor } from '../permissions.js';
import { creditTargets, settlePaidOrder } from './payments.js';
const MAGIC: Record<string, string> = { 'image/png': '89504e47', 'image/jpeg': 'ffd8ff', 'application/pdf': '25504446' };
const METHODS = ['UPI', 'BANK_TRANSFER', 'CHEQUE', 'CASH_DEPOSIT', 'OTHER'];
export interface ProofInput { orderId: string; method: string; reference: string; paidOn: string; claimedPaise: bigint; filename: string; contentType: string; sizeBytes: number; sha256: string; storageKey: string; header?: Buffer; supersedes?: string; now?: Date }
/** A screenshot is only a CLAIM. Uploading never marks the order paid and never credits targets. */
export async function uploadPaymentProof(pool: pg.Pool, actor: Actor, a: ProofInput) {
  const now = a.now ?? new Date();
  if (!(MAGIC[a.contentType])) throw new DomainError('BAD_FILE_TYPE', 'Upload a PNG, JPEG or PDF'); if (a.header && !a.header.toString('hex').startsWith(MAGIC[a.contentType])) throw new DomainError('BAD_FILE_TYPE', 'The file content does not match its type');
  if (!(a.sizeBytes > 0) || a.sizeBytes > 10 * 1024 * 1024) throw new DomainError('FILE_TOO_LARGE', 'The file must be 10 MB or smaller'); if (!METHODS.includes(a.method)) throw new DomainError('BAD_METHOD', 'Choose the payment method');
  if (!a.reference || a.reference.trim().length < 6) throw new DomainError('REFERENCE_REQUIRED', 'Enter the payment reference or UTR number'); if (!/^\d{4}-\d{2}-\d{2}$/.test(a.paidOn) || a.paidOn > now.toISOString().slice(0, 10)) throw new DomainError('BAD_DATE', 'The payment date cannot be in the future');
  if (a.claimedPaise <= 0n) throw new DomainError('BAD_AMOUNT', 'Enter the amount paid');
  const o = (await pool.query('SELECT id, dealer_id, status, total_paise, paid_paise FROM orders WHERE id=$1', [a.orderId])).rows[0]; if (!o) throw new DomainError('NOT_FOUND', 'Order not found');
  if (actor.type === 'DEALER') { if (!can(actor, 'payment.proof.upload.own') || o.dealer_id !== actor.id) throw new DomainError('FORBIDDEN', 'You can upload proof only for your own orders'); } else assertCan(actor, 'payment.proof.upload');
  if (o.status !== 'PENDING_PAYMENT') throw new DomainError('ORDER_NOT_PAYABLE', 'This order is not awaiting payment'); if (a.claimedPaise > BigInt(o.total_paise) - BigInt(o.paid_paise)) throw new DomainError('OVERPAYMENT', 'The amount is more than the balance due');
  if (a.supersedes && !(await pool.query("SELECT 1 FROM payment_proofs WHERE id=$1 AND order_id=$2 AND status='REJECTED'", [a.supersedes, a.orderId])).rowCount) throw new DomainError('BAD_REPLACEMENT', 'Only a rejected proof can be replaced');
  try {
    const r = (await pool.query('INSERT INTO payment_proofs (order_id, method, reference, paid_on, claimed_paise, storage_key, filename, content_type, size_bytes, sha256, uploaded_by_employee_id, uploaded_by_dealer_id, supersedes, uploaded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id',
      [a.orderId, a.method, a.reference.trim(), a.paidOn, a.claimedPaise.toString(), a.storageKey, a.filename, a.contentType, a.sizeBytes, a.sha256, actor.type === 'EMPLOYEE' ? actor.id : null, actor.type === 'DEALER' ? actor.id : null, a.supersedes ?? null, now])).rows[0];
    await pool.query("INSERT INTO notifications (kind, recipient_department, order_id) VALUES ('PAYMENT_PROOF_UPLOADED','FINANCE',$1)", [a.orderId]); return { proofId: r.id as string, status: 'AWAITING_VERIFICATION' as const };
  } catch (e: any) { if (e.code === '23505') throw new DomainError('DUPLICATE_REFERENCE', 'This payment reference has already been submitted'); throw e; }
}
/** Only Finance (or Host) verifies, against the bank/settlement record. Only the VERIFIED amount is credited to the order and the Sales target ledger. Idempotent and race-safe. */
export async function verifyPaymentProof(pool: pg.Pool, actor: Actor, a: { proofId: string; verifiedPaise: bigint; notes: string; now?: Date }) {
  assertCan(actor, 'payment.verify'); const now = a.now ?? new Date();
  if (!a.notes || a.notes.trim().length < 5) throw new DomainError('NOTES_REQUIRED', 'Record how this was verified (for example the bank statement line)');
  return tx(pool, async c => {
    const p = (await c.query('SELECT * FROM payment_proofs WHERE id=$1 FOR UPDATE', [a.proofId])).rows[0]; if (!p) throw new DomainError('NOT_FOUND', 'Proof not found');
    if (p.status === 'VERIFIED') return { already: true as const, paidPaise: BigInt((await c.query('SELECT paid_paise FROM orders WHERE id=$1', [p.order_id])).rows[0].paid_paise), orderPaid: false };
    if (p.status === 'REJECTED') throw new DomainError('ALREADY_REJECTED', 'This proof was rejected. Ask for a replacement upload.');
    if (p.uploaded_by_employee_id === actor.id && actor.role !== 'HOST') throw new DomainError('SELF_VERIFY', 'You cannot verify a payment proof that you uploaded');
    const o = (await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [p.order_id])).rows[0]; if (o.status !== 'PENDING_PAYMENT') throw new DomainError('ORDER_NOT_PAYABLE', 'This order is no longer awaiting payment. Review with Finance.');
    if (a.verifiedPaise <= 0n || a.verifiedPaise > BigInt(p.claimed_paise)) throw new DomainError('BAD_AMOUNT', 'The verified amount must be more than zero and not more than the claim');
    if (a.verifiedPaise > BigInt(o.total_paise) - BigInt(o.paid_paise)) throw new DomainError('OVERPAYMENT', 'This would pay more than the order total');
    const att = (await c.query("INSERT INTO payment_attempts (order_id, provider, idempotency_key, amount_paise, status) VALUES ($1,'MANUAL',$2,$3,'CAPTURED') RETURNING id", [o.id, 'proof:' + p.id, a.verifiedPaise.toString()])).rows[0];
    const cap = (await c.query('INSERT INTO payment_captures (attempt_id, order_id, provider_txn_ref, amount_paise, captured_at) VALUES ($1,$2,$3,$4,$5) RETURNING id', [att.id, o.id, 'MANUAL:' + p.id, a.verifiedPaise.toString(), now])).rows[0];
    await c.query("UPDATE payment_proofs SET status='VERIFIED', verified_paise=$2, decided_by=$3, decided_at=$4, notes=$5, capture_id=$6 WHERE id=$1", [p.id, a.verifiedPaise.toString(), actor.id, now, a.notes.trim(), cap.id]);
    await creditTargets(c, { id: o.id, sales_employee_id: o.sales_employee_id, total_paise: BigInt(o.total_paise) }, a.verifiedPaise, 1, `proof:${p.id}`, 'CREDIT', now);
    const paid = BigInt((await c.query('SELECT paid_paise FROM orders WHERE id=$1', [o.id])).rows[0].paid_paise), full = paid >= BigInt(o.total_paise);
    if (full) await settlePaidOrder(c, o, now, { type: 'EMPLOYEE', id: actor.id }, 'manual payment verified');
    await c.query("INSERT INTO audit_logs (actor_type, actor_id, action, entity, entity_id, after) VALUES ('EMPLOYEE',$1,'PAYMENT_PROOF_VERIFIED','payment_proof',$2,$3)", [actor.id, p.id, JSON.stringify({ verifiedPaise: a.verifiedPaise.toString(), reference: p.reference })]);
    return { already: false as const, paidPaise: paid, orderPaid: full };
  });
}
export async function rejectPaymentProof(pool: pg.Pool, actor: Actor, a: { proofId: string; reason: string; now?: Date }) {
  assertCan(actor, 'payment.verify'); if (!a.reason || a.reason.trim().length < 5) throw new DomainError('REASON_REQUIRED', 'Give the dealer a reason for the rejection');
  const r = await pool.query("UPDATE payment_proofs SET status='REJECTED', rejection_reason=$2, decided_by=$3, decided_at=$4 WHERE id=$1 AND status='AWAITING_VERIFICATION' RETURNING id", [a.proofId, a.reason.trim(), actor.id, a.now ?? new Date()]);
  if (!r.rowCount) throw new DomainError('NOT_PENDING', 'This proof is not awaiting verification'); return { rejected: true };
}
