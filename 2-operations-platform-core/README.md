# S-ELEVEN Operations Platform: verified core (phases 1 to 6 business logic)

PostgreSQL schema + the business rules where mistakes cost money, tested against a REAL database. This is the engine; the web screens and HTTP API are the next build step.

## Run it
```
docker compose up -d db      # or any PostgreSQL 16 (needs the btree_gist extension: included in postgresql-contrib)
npm install
npm run db:migrate           # applies db/migrations/001..003
npm test                     # 52 tests
npm run loadtest             # concurrency + integrity check, prints p50/p95/p99
./scripts/restore-drill.sh   # backup + restore drill
```

## What exists and is proven (52 passing tests)
| Phase | Delivered |
|---|---|
| 1 Foundation | schema (61 tables), Host create-order attribution snapshot, assigned Sales employee lookup, dealer order history (paged), Host warehouse staff status from persistent records |
| 2 Inventory + preorders | stock ledger with before/after quantity, Logistics/Warehouse-only edits, audited Host override, no negative stock (discrepancy flagged), Order Now vs Preorder, oldest-first allocation on stock receipt, dealer + Sales notifications, payment window, reminders that stop, expired stock re-offered |
| 3 Attendance, HR, Branding | 9:30-6:30 shift maths (lunch deducted once, overtime/late/early), clock-in/out protections, Host exempt, missing clock-out flag, Host-approved corrections, month view, leave types/balances/holidays/carry-forward, DB-level overlap protection, no double deduction, leave syncs attendance, HR Host-only, Branding department + designations |
| 4 Warehouse packing | checklist per product line and freebie, per-quantity verification, discrepancies + supervisor notification, Mark as Packed only when complete, company-wide shift lock + Host override (from the first build) |
| 5 Offers, coupons, freebies | coupon engine (percent, fixed, combo, product-specific, brand, dealer, minimum, dates, usage limits) validated on the server, discount spread across lines, line-level freebie exclusions with reasons (combo, specific-product coupon, product, brand, dealer), your 15 default slabs (Host-editable) |
| 6 Samples | separate sample stock, free of cost, approval, awaiting-stock allocation, no payment attempts, no target credit, internal valuation |
| 7/8 | load test with integrity checks, backup/restore drill, operations notes (see docs/OPERATIONS.md) |

## The 20 mandatory scenarios
Covered by automated tests: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19. Partly: 17 (all state is in the database, so it survives refresh and retries; live push updates are not built),
18 (enforced in the data layer; the HTTP layer is not built), 20 (load test measured on a dev machine only; production-like testing still required).

## Not built yet (honest list)
Next.js screens for the new modules (clock-in, HR, Branding dashboard, Sample tab, preorder buttons, packing checklist on phone, Apply Coupon / Add Freebies, inventory screens), NestJS API + login + sessions + MFA, Prisma (use `npx prisma db pull`),
Redis/BullMQ workers (the job functions exist and are idempotent), S3 document storage, real payment-gateway adapter, SSE/WebSocket updates, Finance exports, monitoring stack, Docker for the apps, automatic selection among several overlapping auto-applied offers
(a single coupon code per order is supported), preorder allocation is all-or-nothing per preorder.

## Assumptions to confirm
Lunch (60 min) is deducted when the shift span is 5 hours or more; weekly off is Sunday; preorder payment window 120 min with hourly reminders; preorder price is snapshotted at preorder time; coupon discount reduces the target basis;
whole-order coupons do not block freebies, combo and product-specific coupons do; sample approval is Host-only. All are settings or one-line changes.
