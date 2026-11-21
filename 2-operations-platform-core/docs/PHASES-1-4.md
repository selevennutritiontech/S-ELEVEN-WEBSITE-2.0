# Operations update, phases 1 to 4 (migration 005)

There is no HTTP layer yet: the **service functions are the contract** the future API will expose one-to-one. Every function enforces permissions on the server.

## Permissions added (src/permissions.ts)
| Permission | Who | Meaning |
|---|---|---|
| logistics.read | Logistics, Warehouse, Finance, Host | read-only shared order/shipment/document view |
| document.correct | Finance | upload/correct invoice or e-way bill (explicit grant; Finance still cannot dispatch or write tracking) |
| payment.verify | Finance, Host | verify or reject a manual payment proof |
| payment.proof.upload | Sales, Logistics, Finance | upload a proof for an order |
| payment.proof.upload.own | Dealer | upload a proof for the dealer's own order |
| inventory.edit / inventory.approve | Finance (+Logistics, Warehouse edit) / Finance, Host approve | batch stock operations / approve counts and adjustments |
| inventory.cost.read | Finance, Host | see purchase cost; hidden from everyone else |
| order.mark.seen | Warehouse only | the "seen" event (Host/others cannot mark) |
| order.view.indicator | Sales, Logistics, Finance (+Host, Warehouse) | see the Warehouse indicator |
| employee.create | Host only | employee management; cannot create a Host |

## Rules enforced in the database (cannot be bypassed by a crafted request)
- A Host cannot be created or assigned through employee management; the last active Host cannot be deactivated or deleted; every Host-related change is audited. Another super-administrator needs an existing Host **and** an out-of-band `SUPER_ADMIN_PROVISION_TOKEN`.
- Order creator and Sales attribution are snapshots taken on insert and cannot be changed later.
- `batch_movements` is append-only (UPDATE and DELETE are refused).
- Money received per order (`orders.paid_paise`) is maintained by triggers from captures and refunds, so Razorpay and verified manual payments share one source of truth.

## Payment proof flow
Upload (claim only) -> Finance verifies against the bank record (uploader cannot verify own proof) -> capture + target credit **for the verified amount only** -> when fully paid the order is settled exactly like a Razorpay payment. A UTR can back one live claim; rejected proofs keep their reason and can be replaced.

## Batch inventory
Stock In needs batch, manufacturing and expiry dates. Stock Out follows FEFO (or a chosen batch) and refuses expired, quarantined and damaged stock. Counts and adjustments are requests approved by someone else; stale or reserved-conflicting requests are flagged, never forced. Paying an order consumes batches in FEFO order; a shortfall never blocks a payment, it raises an alert. Products that have batch records cannot be changed through the old product-level functions (`USE_BATCH_INVENTORY`).

## Attendance
Login creates or resumes one attendance session per employee (parallel logins and refreshes never duplicate it). Intentional logout ends the portal session and the attendance together and stores net minutes (lunch deducted once), late and early minutes. Idle expiry and a forgotten sign-out are flagged `needs_recovery`; no end time is invented. Policy lives in `app_settings` key `attendance.policy` (`logoutPolicy` ALWAYS | LAST_SESSION, `idleMinutes`). Run `expireIdleSessions` and `expireBatches` from the scheduler.

## Not built yet (phases 5 to 9)
Returns and inward, dealer ledger and notes, Finance queues and incentive reports, Sales pending-orders tasks, the shared preorder views, the three demo scenarios, the HTTP API and the connected screens, and production-like load testing.
