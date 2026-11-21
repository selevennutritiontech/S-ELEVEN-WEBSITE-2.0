# S-ELEVEN security and performance audit: report

Date of testing: 2026-10-29. Scope: the project as delivered (browser portal, TypeScript backend core, Google Apps Script, WhatsApp extension).
All tests ran in an isolated sandbox against copies with demo data and a throwaway local PostgreSQL 16. Nothing was run against production or third parties.

## 1. Executive summary
**The application did NOT pass a production security target, and no 5,000-user capacity is claimed.**
The portal is a browser-only demo: all data, logins and permissions live in the browser. Anyone who can open the page can read or change everything, become the Host or any dealer without a password, and read every password. These are design limits, not bugs fixable inside the browser: they need a real server (API with hashed passwords, sessions and server-side permission checks). The backend core (business rules + PostgreSQL) is sound on its own tests, but has no HTTP layer yet.
Two real code flaws were found and fixed (disguised-file upload that ran script in the portal; formula injection into Google Sheets/CSV). No XSS was found in 14 injected fields across 16 pages.

## 2. Architecture and attack surface
- 1-website-and-dealer-portal: plain JS/HTML, data in browser storage (no server, no API, no database).
- 2-operations-platform-core: TypeScript services + PostgreSQL schema (61 tables, 5 migrations), 88 tests. No HTTP routes; the caller supplies the acting user.
- Google Apps Script receiver (shared-secret web app), WhatsApp browser extension, local launcher (python http.server).
- External services: Google Fonts only. No payment gateway, email or file storage is connected.

## 3. Findings
| ID | Finding | Severity | Evidence | Status |
|---|---|---|---|---|
| S1 | Passwords stored in plain text in browser storage; any signed-in user can read all dealer and employee passwords | Critical (for real use) | Dealer session read 3 dealer and 12 employee passwords | Open: needs server + password hashing |
| S2 | No data isolation: dealer DEMO001 reads DEMO002/DEMO003 orders | Critical | 28 and 29 other-dealer orders returned | Open: needs server |
| S3 | Session forgery: write a small JSON value and become Host (no password, "2FA done" flag set by the browser) | Critical | Host menu loaded with no login | Open: needs server |
| S3b | Dealer session is just the dealer code: become any dealer | Critical | Dealer home loaded as DEMO002 | Open: needs server |
| S4 | Roles are an argument the caller supplies: a dealer called an admin-only function claiming role "admin" and reset another dealer's password | Critical | New password accepted | Open: needs server |
| S5 | No brute-force protection or lockout | High (once there is a server) | 300 wrong passwords, then correct one worked | Open |
| S8 | Invoice/e-way upload accepted any file named .pdf; opening it ran its script inside the portal and could read all portal data (stored XSS) | High | Popup title "PWNED:54:can-read-portal-data" | FIXED |
| S9 | Google script secret readable by any user of the browser | Medium | Dealer session read it | Open: needs server-side calls |
| S10 | Names starting with = + @ were sent to Google Sheets as live formulas and exported to CSV (formula injection) | Medium | 331 rows carried a raw =HYPERLINK | FIXED |
| S11 | No Content-Security-Policy, X-Frame-Options, nosniff, HSTS | Medium (deployment) | Response headers empty | Open: set on the real web server |
| S12 | docker-compose publishes PostgreSQL (seleven/seleven) and Redis with no password on all interfaces | Medium (dev only) | Read from file | Open: bind to localhost, strong passwords |
| S13 | Local launcher serves the folder to the whole network on port 8080 | Low | Read from file | Open |
| S6 | Account enumeration | none found | Unknown code and wrong password give the same answer | OK |
| S7 | Stored XSS | none found | 14 fields x 16 pages + order pop-up: nothing executed | OK |
Not tested: SQL injection / CSRF / SSRF / IDOR over HTTP, CORS, TLS (no server exists). The backend uses parameterised queries and its own tests pass, but no HTTP surface could be probed.

## 4. Fixed, with files
- db.js: okPdf() now requires real PDF content (magic bytes), not just a .pdf name, and measures size from the real data.
- admin.js, app.js: openFile() only opens PDF/PNG/JPEG as such; anything else becomes a download and can never run as a page (also protects files stored before the fix). csvDown(): text starting with = + @ is written as text.
- sheets.js: automatic columns are always plain text; rows sent to Google and CSV exports protect formula-looking text.
- 2-operations-platform-core/google-sheets/Code.gs: same protection on the Google side.
- Regression tests: security-audit/regression-tests.py (16 checks, all pass).

## 5. Remaining vulnerabilities and recommended actions
1. Build the server: API with Argon2id/scrypt password hashes, server-side sessions or short-lived signed tokens, role and ownership checks on every endpoint, rate limiting and lockout, audit log. Wire the existing backend services behind it. This closes S1 to S5 and S9.
2. Set CSP, X-Frame-Options, nosniff, HSTS and CORS on the web server; force HTTPS.
3. Move the Google call and its secret to the server.
4. Rotate nothing now (no real secret was found), but never reuse the demo logins (ADMIN/admin123 etc.) or the docker-compose passwords.
5. Re-run the attack and regression tests, ZAP and Semgrep against the staging server once it exists.

## 6. Dependency audit
Backend: 21 packages (pg + dev tools), `npm audit`: 0 vulnerabilities, TypeScript check clean. Frontend: no npm packages, no third-party scripts. Not run: Semgrep and OWASP ZAP (rule downloads/tooling not available in the sandbox; ZAP has no server to scan).

## 7. Load and performance (measured, NOT a 5,000-user test)
Environment: 1 CPU core sandbox, local PostgreSQL 16, pool of 25, 20 concurrent workers, synthetic data. The portal has no server, so there is nothing to load with 5,000 users.
| Workflow | n | concurrency | p50 | p95 | p99 | throughput | errors |
|---|---|---|---|---|---|---|---|
| create order (1-3 lines) | 600 | 20 | 61 ms | 394 ms | 742 ms | 170/s | 0 |
| payment (initiate + webhook) | 600 | 20 | 114 ms | 548 ms | 1588 ms | 104/s | 0 |
| dealer history page | 400 | 20 | 51 ms | 90 ms | 108 ms | 370/s | 0 |
| replayed (duplicate) webhooks | 600 | 20 | 9 ms | 18 ms | 21 ms | 1991/s | 0 |
Integrity: 600 orders, 600 paid, 600 captures, 0 inventory violations, duplicate replays changed nothing. CPU/memory/connection-pool saturation were not measured. These numbers do not show how the system behaves at 50, 500 or 5,000 users.

## 8. Automated tests
Backend (real PostgreSQL): 88 of 88 pass (includes 2FA, lockout, duplicate-submission and stock-integrity tests). New security regression tests: 16 of 16 pass. Browser suites for the portal: all pass except t220 (one check, intermittent: two browser tabs sometimes see a change late; the behaviour itself was verified directly).

## 9. Production checklist and rollback
Before going live: items in section 5; HTTPS; secrets in environment/secret manager; managed PostgreSQL with backups and a tested restore (scripts/restore-drill.sh); monitoring; staging load test with the staged plan (10, 50, 100, 250, 500, 1000, 2500, 5000 users) with stop thresholds.
Rollback: keep the previous release folder/zip; a backup of the pre-audit project is at backup-pre-audit-20261028.tar.gz; database changes go through the numbered migrations (take a backup first).

## 10. Could not be tested
Real server behaviour (none exists), HTTP-level injection/CSRF/SSRF/IDOR, TLS and headers on a real host, ZAP, Semgrep, Safari, real Google, infrastructure metrics (CPU/memory/pool), any test beyond 20 concurrent workers.

## 11. Conclusion
Security target: NOT met (architecture). Load target (5,000 users): NOT tested, no claim. The two code flaws that could be fixed in place were fixed and verified. Do not put real dealer, employee or payment data into this version until the server layer is built and re-audited.

---

## 12. Update (v21): the server layer was built and tested

The architecture finding in sections 2 and 5 (no server, so passwords, data isolation, sessions and secrets could not be protected) is addressed by the new folder `4-secure-server`. It is a Node.js + PostgreSQL server that serves the portal and does the security work. The portal's own business logic runs on the server, as the signed-in person; the browser holds only a read-only, in-memory copy of what that person may see. Opened as a plain file (demo mode) the portal works as before, with the old weaknesses: **the demo must never be put on the internet; only the server deployment is intended for that.**

| Finding | Status with the server | How it was tested |
|---|---|---|
| S1 passwords readable | Closed. Only scrypt hashes exist, held outside the data. Nothing sent to any browser contains a password or hash. The "view current password" feature was removed (a reset shows the new password once). | Every response for 6 roles scanned; real browser: no password in storage, mirror or responses. |
| S2 dealer reads other dealers' orders | Closed. A dealer receives only their own record, orders and ledger. Supplier data is removed from stock sent to dealers. | Server tests; real browser (dealers 1, 2, 3). |
| S3 / S3b forged Host or dealer session | Closed. Identity comes only from an HttpOnly, SameSite=Strict session cookie. Writing identity into browser storage is overwritten at load and has no effect. | Real browser: forged Host and forged dealer code both land on the login screen. |
| S4 claiming role "admin" | Closed. The server overwrites "who" and "role" from the session. Dealers may call only about a dozen order operations, forced to their own account. Host-only, HR, Finance, Warehouse, Logistics and stock operations are limited by department. | Server tests (22 forbidden operations refused, nothing changed); real browser. |
| S5 no brute-force limit | Closed. 5 wrong passwords lock the account for 15 minutes (doubling on repeats), also for unknown accounts; each address is limited; failures are audited. | Server tests; real browser: 5 refusals, then 429 even for the right password. |
| S9 Google secret readable | Closed. Encrypted on the server, write-only, never sent to a browser; the server forwards rows itself and chooses the target sheet. | Server tests (secret absent from every response and from storage at rest); real browser. |
| S11 no security headers | Closed for the server: CSP (scripts only from the site itself), frame blocking, no-sniffing, referrer, permissions, cache and, in production, HSTS. | Server tests; headers checked in production mode; CSP blocked script evaluation in the browser. |
| Price tampering (new) | Closed. The server prices every order line from the catalogue and the dealer's price list and ignores the browser's totals, status, payment state and "created by". | Server tests; real browser (forged price 1 stored as 543). |
| First-start demo accounts (found during the build) | Fixed. A clean production start contains only the Host, with the password chosen at install; the server refuses to start otherwise. | Server tests; production-mode run. |

**Tests run:** 26 server tests pass against PostgreSQL (25 of 25 in memory; the restart-durability test runs only against PostgreSQL), `npm audit` reports 0 vulnerabilities, 12 and 37 checks pass in a real browser against the server (every role opening every page; a complete order through Sales, Finance, Logistics, Warehouse and the dealer with visibility checked at each step; the audit attacks again), and the earlier demo-mode suites were rerun after the changes.

**Still open or not verified (be clear before going live):**
- **HTTPS is required.** The Docker files and Caddy example are provided but **could not be built or run in this environment (no Docker here)**; they were checked for syntax only. The server itself was run in production mode against PostgreSQL.
- Dealer payments: dealers can no longer mark their own order paid. A payment-gateway webhook is not connected, so Finance/Sales confirm payments after checking the bank.
- Staff permissions are explicit for money, stock, warehouse, HR and Host operations; other staff operations rely on checks inside each function. A per-function review is recommended.
- In-portal Sheets workbooks are still kept in each person's browser (per user). Rows sent to Google go through the server.
- One server process only. No two-factor sign-in yet. Existing browser demo data cannot be imported.
- Not tested: Safari and Firefox, real Google Apps Script, a real locked or shut-down PC, a 5,000-user load test of the server, penetration testing by an independent party. These tests are by the builder, not independent.
- Security target: **met for the six reported issues when served by the server over HTTPS, with the limits above. Load target: not tested.**

---

## 13. Update (v22): dispatch, tracking and delivery rules; logistics charges; sample shipping

Business rules requested after testing, now enforced in the data layer, on the server (department rules) and on screen:

| Rule | Where enforced | Tested |
|---|---|---|
| Only the Warehouse presses "Order dispatched", and only when the invoice (and the e-way bill above Rs 50,000) is uploaded | data layer + server department rule | 10 server tests; on-screen: button disabled with the reason for L1/L3, enabled for L2; Logistics, Finance, Host and Sales refused |
| Tracking is added only by Logistics or Finance, and only AFTER the Warehouse dispatched | data layer + server department rule + disabled button | server tests; on-screen |
| No order can reach "in transit" while the invoice or e-way bill is pending (by dispatch, shipment update, out-for-delivery or delivered) | data layer | server tests (5 routes tried) |
| Only Logistics marks out for delivery / delivered | data layer + server department rule | server tests (Finance, Host, Warehouse, Sales refused) |
| Sample shipping: fixed Rs 150, borne by the company, counted in the analytics only (not in any partner's "paid", not in any dealer ledger, counted once) | data layer | server test |

Also fixed: the Logistics dashboard tile said "Ready to dispatch: add courier and tracking" (now "Add tracking", counting only dispatched orders); Logistics rows show a red "E-way bill / Invoice pending: cannot be dispatched yet"; the charges-per-partner analytics moved from the bottom of the Orders page to the **Analytics** tab (Logistics; Host and Finance when viewing Logistics); the Host **Order tracker** sheet now runs Dispatch before Tracking (existing workbooks get the new headings); completed historic orders no longer show "Invoice pending".

**Test status for this change:** 42 server tests pass against PostgreSQL (41 in memory plus 1 PostgreSQL-only test); secure-mode browser suites pass (every role and page; a full order through all departments; the on-screen rules); the older demo-mode suites pass at their earlier counts, with these exceptions that I could not make reliable: **t260 (attendance, two browser tabs) and t180 (order steps) fail intermittently in this environment, and did so on the previous package too** (t260 failed 6 of 7 runs on the previous package and 7 of 13 on the current one, so the two are not distinguishable). They were not caused by this change as far as I can tell, but I did not find their root cause; treat attendance behaviour in demo mode as not fully verified. t230 and t261 were updated to the new sequence (dispatch, then tracking), which is the business rule you set.

I could not determine why earlier suites passed with tracking before dispatch; the current behaviour is the requested rule and is tested directly.

---

## 14. Update (v23): the employee login is no longer public

- The public website no longer has an "Employee Login" link (navigation or footer).
- With the secure server, the employee console exists **only** at a private address (default `/access/employee-server`, changeable with `STAFF_PATH`). `/admin/`, `/dealer-portal/admin/`, `/employee/`, `/backend/` and `README.md` return 404. The page carries `noindex` headers and is never cached.
- One server can serve the whole site on one domain: the website at `/`, the dealer portal at `/dealer-portal/`, the employee login at the private address. The website's own inline script is allowed by fingerprint; no other page is relaxed.
- `vercel.json` now redirects `/employee/` and `/dealer-portal/admin/` away, in case the static site is ever deployed on a static host.
- **A private address is not a lock.** It keeps the page from being found; the protection of staff accounts is still the hashed passwords and the lockout. If the link leaks, change `STAFF_PATH` and restart. Anyone who has the link can see the login screen.
- Tested: 3 new server tests (both layouts, old addresses refused, unsafe `STAFF_PATH` values refused) and an 18-check real-browser test of the one-domain layout.
- Note: the demo launchers and demo logins have been removed; a plain-file copy of the portal shows no data and no login.
- Demo-mode test reliability (honest note): t260 (attendance), t180 (order steps), t220 (dealer password cross-tab checks) and t242 ("Sales sees the new order") fail intermittently in this environment. t242 failed 1 of 5 runs on the current package and 1 of 6 on the earlier one; t260 and t180 failed on the earlier package too. Root causes were not found; they look like timing problems in tests that drive two browser tabs at once. These suites run only the local demo, not the secure server, whose own tests (45 server tests, 4 browser suites) passed on every run.

---

## 15. Update (v24): business rules, Warehouse payment privacy, returns and replacements

- **Warehouse payment privacy (security-relevant):** the server removes proofs, receipts, payment method, reference, dates and payment lines of the status history from every order sent to a Warehouse session; the screens show "Payment details unavailable for you". Tested on the server (the data never leaves it) and in a browser.
- **Offer visibility by dealer category** is enforced on the server (a dealer does not receive offers for other categories) and when a coupon is used.
- **Dispatch chain and locks** are enforced in the data layer and on the server by department (see README section 6).
- **21-day window** for returns and replacements, enforced for everyone including the Host.
- **Replacement balance** is calculated on the server from catalogue and dealer prices and posted to the dealer ledger as a debit or credit note.
- Tests added: 9 server tests (delivery chain, Warehouse masking, returns) and 3 browser suites (offers/delivery/Warehouse screens; Sheets; returns and replacement). All pass.
- Not verified: real Google Sheets (nothing connected here); product pictures replaced by the brand-website versions (the same pictures were moved to the website folder; replace them to change); colours on every page (reviewed on the Sales dashboard only); Docker image build.
- **A flaw found and fixed during this work (data-loss risk, demo mode):** the first version of the Warehouse payment masking replaced the shared order readers in the Warehouse's browser. Internal functions that read an order and then saved it back could therefore have stored a masked copy over the real order, destroying payment proofs. The masking now happens only when a screen is drawn, and every function that saves orders reads the real stored data. A regression test (Warehouse works through its orders; no order's payment, proofs or receipt changes in storage) was added. The secure server was never affected: it keeps the real data and sends masked copies only.
- **Final test status:** 54 server tests (54 pass on PostgreSQL; 53 pass and 1 PostgreSQL-only test skipped in memory), 0 vulnerabilities in dependencies; secure-mode browser suites 12, 37, 20, 12, 10, 17 and the one-domain suite 18, all passing; demo-mode suites all passing except t260 (attendance, two browser tabs), which fails intermittently in this environment and did so before these changes.
- **Colours:** main colour pairs measured at 5.9:1 to 14.3:1 (readability standard is 4.5:1).

---

## 16. Update (v25): new palette, Google sheets repaired, CRM, Field Sales Consultants

- **Colour palette** changed for the employee console and the dealer portal (colours only). A rule added in the previous version (v24) made the inactive menu labels of the staff console almost invisible (dark on dark); it was introduced by me and not noticed; it is fixed in this version and the readable contrast of the main colour pairs was measured (5.6:1 to 11.7:1).
- **Google sheets:** found and fixed (a) rows were discarded when Google's script answered "wrong secret" or "sheet not shared"; (b) a department's sheet updated only when someone from that department had the portal open; (c) no error was ever shown. The server now builds the department sheets itself, keeps rows until Google accepts them, and shows the exact reason. Tested with the real `Code.gs` running against a stand-in for Google (5 tests). **Not tested against real Google.**
- **CRM and Field Sales Consultants** are enforced on the server: only the Host creates consultants; brand switches only by the allocated Sales person or the Host; a consultant receives only their own dealers, orders, returns, ledgers and commission, never other consultants' commission rates or the company's data; consultants cannot call offer, target, sample, CRM or Host operations; Sales receive CRM data only for their own leads.
- **Two defects in my own work were found by tests and fixed before release:**
  1. The server's order builder ignored an order refusal from the data layer and reported success. Any order rule (for example "brand not activated") would have been silently bypassed on the server.
  2. Wrapping two operations with shorter parameter lists hid their `role` parameter from the server's identity override. A new test now checks that all 94 operations that take a caller identity or role still declare them at the same position.
- Tests added: 9 server tests (CRM, consultants, commission, scoping, identity parameters), 1 for the Field Sales sheet, and a 40-check real-browser journey (CRM lead to dealer, Create order from CRM, Host creates a consultant, brand switches, the consultant's own screens and commission).
- A dealer created from a CRM lead has no purchase prices; to avoid orders silently at full MRP it is blocked from ordering (on the server too) until prices are saved, and the Dealers list shows "Prices not set". Found while testing a consultant adding a dealer through the Dealers page, which already required prices.

---

## 17. Update (v26): Field Sales restructured, Visits, RTO, on-field orders

- **Field Sales Consultants can no longer create dealers:** the data layer blocks it with a clear message. The ACL lets the call through so the message reaches the browser; the server enforces identity as before. Sales creates the dealer with `salesEmp` pointing to the consultant.
- **RTO approval** is gated to the Host (admin role) on both the ACL and the data layer. An RTO request generates a staff notification with `popup: 'rto'`; the admin console checks for it after every render and opens a modal with Approve / Reject.
- **Visits** are scoped: a consultant sees only their own; the allocated Sales person sees their consultants'; the Host sees all; others see none.
- **On-field orders** are tagged by `DB.isFieldOrder` (checks the order's `attr.emp` against the employees store). Sales sees only their consultants' orders; Finance and Logistics see all.
- **Identity parameter guard** updated to 109 operations (was 94).
- Tests: 10 server tests (CRM, Field Sales, visits, RTO, on-field tagging, identity params); 5 Google sheets tests; browser journey tests.

---

## 18. Update (v27): Field Sales as a limited department; dealer data minimisation

- **Create-only consultants, in three layers:** the buttons are not drawn; the data layer refuses (parameter lists unchanged, so the server still finds `by` and `role`); and the server discards any write from a consultant that is not on an allow-list (a Map was first counted with `.length`, so the guard never fired; found by a test and fixed). 16 attempted operations are refused and change nothing.
- **State rule:** a consultant can create a dealer only inside the allocated state; the pincode decides; the refusal names both states.
- **Found and fixed:** (1) dealers received staff **user IDs** (SALES, LOGISTICS, FINANCE...) inside their order records: now opaque aliases; (2) dealers received **other dealers' codes** in post likes: now a count and their own like; (3) `markPaid` (which earns commission) was callable by any employee-role account: now Host, HR, Finance and Sales only; (4) the Team form suggested an 8-character password that the secure server rejects, so creating an employee failed quietly: now 12 characters with the required mix and the error is shown on the form; (5) the first version of the sample-data step threw on an install with no demo dealers: it now creates nothing there.
- **Passwords:** never sent to anyone (tested for dealers, Sales, consultants and the Host); the console shows none (lists masked, no "current password" field in the dealer form); a new password is displayed once when it is set. The double-click demo still keeps data in the browser's own storage and cannot be truly secure: the protection is the server build.
- **Tests:** server 88 (all pass on PostgreSQL; 87 pass and 1 PostgreSQL-only skipped in memory), including 14 field-sales, 9 sample-data, 7 isolation and the identity-parameter guard (now 109+ operations). Browser, secure mode: 55-check journey, 65-check filter test, and the earlier suites. Browser, demo mode: all older suites plus a 6-check upgrade and clean-start test; several older expectations were updated on purpose (new top-bar label, new sample counts, removed "show password" feature) and each is listed in the change notes.
- **Not verified:** real Google Sheets; the Docker image; Safari and Firefox; a load test.

---

## 19. Update (v28): two-step sign-in, tighter roles

- **Google Authenticator (TOTP, RFC 6238)** for staff of every department, default ON in production. Verified server-side in the request that carries the code; stored encrypted; one use per code; wrong codes count toward the account lockout; no session until the code is right; the Host can switch it per department and reset a lost phone (which also ends that person's sessions); an emergency start-up reset exists for a lost Host phone. 8 server tests and a 19-check real-browser test cover enrolment, immediate refusal of a wrong code, replay refusal, the Host's page and a reset.
- **Dealers:** no employee information at all is sent (previously the contact person's name and mobile were). Tested.
- **Consultants:** create-only (unchanged), plus: no attendance or allowances, inventory limited to activated brands on the server, own visits editable (owner only), record changes by the Host only (HR refused: tested for five operations).
- **Commission:** Host only; percentage, fixed amount per order, or order-size slabs; validated; the senior cannot change it.
- **Warehouse:** stock changes are refused for the Warehouse (11 operations tested); logistics cost removed from what it receives.
- **Found and fixed during this update:** a menu edit that removed Sheets and WhatsApp for every role (caught by a test); literal `\u00B7` text in the Sales page (present in the previous build); the create-only guard's earlier miscount; the Host's RTO pop-up forgetting "Decide later" after a reload in demo mode (it was keyed on a timestamp that changes each load; this was also the cause of several intermittent test failures).
- **Test coverage, stated plainly:** server 105 tests (105 pass on PostgreSQL; 104 pass and 1 PostgreSQL-only test skipped in memory); dependency audit 0 vulnerabilities; real-browser tests for the consultant screens and commission editor (26 checks), the secure authenticator flow (19), Eleven (19), the update pop-up (13) and a smoke test that opens every menu page of nine roles. The earlier large browser regression suites (v24 to v27, about 700 checks) could not be rerun for this build because the test machine was reset; their last results are for v27.
- **Known limits:** the double-click demo keeps data in the browser's own storage, which is not fully reliable across tabs and reloads, and it cannot be truly secure; creating an employee echoes the typed password back to the Host in the response (not stored in clear).
- **Not verified:** real Google Sheets, the Docker image, Safari and Firefox, a load test.

---

## 20. Independent adversarial pass (final audit)

A separate test file, `4-secure-server/test/audit.test.js`, was written from the attacker's side — independent of the regression suite — and run against the live server. Every check asserts the server *refuses*. All 10 pass:

- Anonymous requests to `/api/state`, `/api/security`, `/api/sheets/config`, `/api/rpc`, `/api/closing` are refused; `/api/me` answers the login probe with `{signedIn:false}` and no identity or data.
- Forged, empty, and mutated session cookies never authenticate.
- A write with no CSRF token, a wrong token, or a foreign `Origin` is refused.
- A dealer session receives only its own records — no other dealer's keys, no employee records, no password or hash material.
- A dealer cannot read, pay against, cancel, or confirm another dealer's order through the data layer.
- Staff-only actions (`saveEmployee`, `setFieldCommission`, `verifyProof`, `receiveStock`, the Security page) are refused from a dealer session.
- Department boundaries hold: Warehouse cannot move stock or set commission; Sales cannot reach HR actions.
- Path traversal and the hidden `/employee`, `/backend`, `.env` paths return 404/403/400.
- Non-GET methods on static files return 405; malformed JSON bodies are rejected, not crashed.
- An unknown rpc name is rejected, and a mass-assignment attempt on a dealer's own `creditLimit`/`salesEmp` does not take.

Full server suite after adding this file: **115 tests, 114 pass, 1 skipped (Postgres-only), 0 fail**; `npm audit` **0 vulnerabilities**.

These results cover the tested scope only. Not demonstrated here: load behaviour at 50–100 or 5,000 concurrent users, and live Vercel / Neon / GoDaddy configuration — those need the real hosting accounts and a staging environment, which this build cannot reach.

## 21. Deep audit — authentication, order & payment integrity, concurrency, hygiene

A second authorized suite, `4-secure-server/test/audit2.test.js`, drives the live server through the business-critical paths. All 9 pass:

- **Account lockout** after repeated wrong passwords (the correct password is refused while locked), and an unknown user is indistinguishable from a known user with a wrong password (no account enumeration).
- **Logout** invalidates the session cookie at once — the old cookie no longer authenticates.
- **Price integrity:** a dealer-supplied line `price`/`discount` is ignored; the server charges the authoritative dealer price and computes the subtotal from it.
- **Coupon integrity:** a bogus or non-eligible coupon code does not reduce the payable total.
- **Quantity integrity:** negative, zero, fractional, and over-large quantities cannot create a charge.
- **Payment integrity:** a verified proof credits the order once; re-verifying the same proof does not double-credit. (Proof is recorded by Sales and verified by Finance — separation of duties.)
- **No oversell:** many concurrent orders for one SKU never drive available stock below zero; reserved never exceeds on-hand. Requests are serialized through the commit chain, so the reservation is race-free.
- **Input validation:** type-confusion and junk arguments produce a handled error, never a 500 crash.
- **Response hygiene:** `X-Content-Type-Options`, `Content-Security-Policy`, and `Referrer-Policy` are set; the session cookie is `HttpOnly` + `SameSite`; error bodies carry no stack trace.

**Combined result:** server suite **124 tests — 124 pass on PostgreSQL (123 pass + 1 Postgres-only skip in memory mode), 0 fail**; `npm audit` **0 vulnerabilities**; a real-browser smoke confirms the public site and dealer portal load, dealer and Host sign-in work, the hidden `/employee` and `/.env` paths return 404, and no uncaught script errors occur.

No defect was found in any tested path. The `test/audit.test.js` and `test/audit2.test.js` files ship with the package and run with every `npm test`, so these checks are permanent regressions.

## 22. v29 note — upload/delete confirmation gate

A "shoot the file through the hoop" confirmation (`confirmshot.js`) now gates every employee file upload (invoice, e-way bill, payment proof, banner) and record delete (dealer, offer, CRM lead, courier, freebie, post). It is a client-side UX control, not a security boundary — the server's authorization and validation are unchanged and still enforced independently. The backend audit suites (`test/audit.test.js`, `test/audit2.test.js`) remain green after this change.

