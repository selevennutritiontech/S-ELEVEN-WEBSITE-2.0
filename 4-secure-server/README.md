# S-ELEVEN secure portal server

This is the server that makes the portal safe to put on the internet. It serves the dealer portal (`/`) and the staff console (`/admin/`) and does the security work the browser cannot:

- **Passwords** are stored only as scrypt hashes. Nobody, including the Host, can read a password. A reset shows the new one once.
- **Sessions**: the signed-in person is identified by an HttpOnly, SameSite=Strict cookie. The browser cannot claim an identity or a role.
- **Every operation is checked on the server** and runs as the signed-in person. Dealers can call only their own order operations; price, totals and "who created it" are set by the server.
- **Each person receives only the data they may see.** A dealer gets only their own record and orders. Departments get only the orders their step of the flow allows.
- **Lockout**: 5 wrong passwords lock the account for 15 minutes (doubling on repeats); each address is also throttled. Failures are in the audit log.
- **Google secret** is encrypted on the server (key from `APP_SECRET_KEY`), write-only, and never sent to a browser. The server forwards sheet rows itself.
- **Security headers** (CSP, frame blocking, no-sniffing, referrer, permissions, HSTS) on every response.

## 1. Try it on your computer (no Docker)

```
cd 4-secure-server
npm install
INITIAL_ADMIN_PASSWORD='Choose-A-Strong-Pass-1' COOKIE_INSECURE_DEV=1 REQUIRE_2FA=0 node src/server.js
```
Open http://localhost:8080/access/employee-server and sign in as `ADMIN` with the password you chose. The system always starts **clean**: only the ADMIN login, every product with 100 pcs of stock, and no dealers, employees or orders. (Sample demo data exists only inside the automated tests.) `COOKIE_INSECURE_DEV` is for running on your own computer without HTTPS; the server refuses to start in production with it set. Without `DATABASE_URL` the data is kept in memory and disappears when the server stops.

## 2. Put it on a server (Docker, any VPS or cloud VM)

You need: a Linux server with Docker, and a domain name pointing at it.

1. Copy the whole package folder to the server.
2. `cp 4-secure-server/.env.example 4-secure-server/.env` and fill it in (`openssl rand -hex 32` for `APP_SECRET_KEY`, a long random `DB_PASSWORD`, and your chosen `INITIAL_ADMIN_PASSWORD`, at least 10 characters).
3. Start: `docker compose -f 4-secure-server/docker-compose.yml --env-file 4-secure-server/.env up -d --build`
4. Remove `INITIAL_ADMIN_PASSWORD` from `.env` (it is only used on the first start).
5. Add HTTPS with Caddy: install Caddy, put your domain into `deploy/Caddyfile`, and run it. The app listens only on 127.0.0.1:8080, and the database is not exposed to the network at all.
6. Open `https://your-domain/access/employee-server` and sign in as `ADMIN` with the password you chose. A real installation starts empty: add employees (Team), dealers and stock yourself.
7. Backups: schedule `deploy/backup.sh` (nightly) and copy the files off the server. To restore: `gunzip -c file.sql.gz | docker compose exec -T db psql -U seleven seleven`.

### Where everything lives (one domain)

With the Docker setup the server serves **everything** from one domain, for example `www.s-eleven.com`:

| Address | What it is |
|---|---|
| `/` | the public website (no employee link anywhere on it) |
| `/dealer-portal/` | dealer login and portal |
| `/access/employee-server` | **the employee login: the only address that exists for it.** Give this link only to employees. |
| `/admin/`, `/employee/` | do not exist (404) |

Change the employee address to something only you know by setting `STAFF_PATH` in `.env`, for example `STAFF_PATH=/access/staff-7k3m9x` (lower-case letters, digits and dashes). If the link ever leaks, change it and restart: the old one stops working at once.
The address is not a lock: it only keeps the page from being found. What actually protects the staff accounts is the hashed passwords and the lockout after 5 wrong tries. The page tells search engines not to index it.
If you keep the public website on another host (for example Vercel) and run only the portal here, the employee login will be on the portal's domain instead, and the website must not contain the `employee/` or `dealer-portal/admin/` folders (the included `vercel.json` redirects them away).

HTTPS is mandatory in production: the session cookie is marked Secure and will not be sent over plain http.

## 3. Settings

| Variable | Meaning |
|---|---|
| `NODE_ENV=production` | Enables the safety checks. The server will not start with unsafe settings. |
| `DATABASE_URL` | PostgreSQL connection. Required in production. |
| `APP_SECRET_KEY` | 64 hex characters. Encrypts the stored Google secret. Keep it safe: losing it means re-entering the Google secret. |
| `INITIAL_ADMIN_PASSWORD` | First start only: the Host password. |
| `TRUST_PROXY=1` | Behind Caddy/nginx: use the real client address for rate limits. |
| `SESSION_IDLE_MIN`, `SESSION_MAX_HOURS` | Idle timeout (default 120 min) and absolute limit (default 14 h). |
| `ALLOWED_ORIGINS` | Extra origins allowed to call the API (normally none). |
| `STAFF_PATH` | The private address of the employee login (default `/access/employee-server`). |
| `SITE_DIR` | Folder of the whole website; set by the Docker image. Without it only the dealer portal is served, at `/`. |

## 4. Tests

```
npm test                                                     # in memory
TEST_DATABASE_URL=postgres://user:pass@host:5432/testdb npm test   # against PostgreSQL (also tests restart durability). Use an empty test database: it is wiped.
```

## 5. Known limits (read before going live)

- **Dealer payments**: a dealer can no longer mark their own order paid. In production, payments must be confirmed by Finance/Sales after checking the bank, or by a payment-gateway webhook (not yet connected).
- **Staff permissions** are explicit for money, stock, warehouse, HR and Host operations; other staff operations rely on the checks inside each function. A per-function review is recommended before many staff use it.
- **Sheets workbooks** (the in-portal spreadsheets) are still kept in each person's browser, per user. Rows sent to Google go through the server.
- **One server process** only (state is held in memory and saved to PostgreSQL on every change). Do not run two copies against one database.
- **No two-factor sign-in** yet.
- **Existing browser demo data cannot be imported**; a real installation starts from zero.
- Not load-tested at 5,000 users.

## 6. Business rules built into this version (v24)

- **Offers** have a "Visible to" setting (all dealer categories, or one category). A dealer receives only the offers made visible to their category; a coupon from another category is refused.
- **Orders** can be edited whatever offers or freebies they carry (the coupon is re-checked against the new items). After delivery nothing about an order's documents, notes or details can be changed.
- **Dispatch chain:** Logistics or Finance push an order to the Warehouse as soon as the invoice is attached (a pop-up appears for orders up to Rs 50,000). The e-way bill (above Rs 50,000) blocks only "Order dispatched". Tracking is added after dispatch, only for the dispatch partner chosen earlier. The packing note locks once the Warehouse dispatches. Only Logistics marks out for delivery or delivered.
- **The Warehouse never sees payment details** (proofs, receipt, method, dates); the server does not send them.
- **Returns and replacements** can be requested only within 21 days after delivery. When Finance sends a replacement it selects the products; the balance against the returned goods goes into the dealer's ledger and is shown on the dealer's order. Sales sees the returns of all dealers.
- **Product pictures** come from one place only: the website's `assets/products` folder (one file per product id; see the README there).
- **Google Sheets:** the system sheets and the linked Google sheets update every minute on their own (and on "Sync now"). Every sheet has a visible CSV download.
- **Colours:** muted sage #A5A79B, warm cream #E8D285 and deep burgundy #590907 (css/theme.css).

## 7. CRM, Field Sales Consultants and Google sheets (v25)

- **CRM** (Sales team, top navigation bar): each Sales person keeps their own leads and dealer data (name, contact, phone, GST, address, category, status, notes). Duplicates (same phone or GST, in the CRM or already a dealer) are refused. A lead becomes a dealer with **Create dealer**: the details are fetched into a confirmation window, the dealer code is suggested, and a login password is generated and shown once. A dealer made this way has **no purchase prices yet** and cannot order (it would be MRP by accident) until Sales adds them in Dealers > Edit dealer; the Dealers list marks it "Prices not set". The same is available in **Create order > Choose dealer from CRM**. The Host sees all leads; nobody else does.
- **Field Sales Consultants** (a separate department; the login is the normal employee login, so nothing about them appears on the public website):
  - Only the **Host** creates a consultant (Field sales page), with a zone, a city and the **Sales person they are allocated to**.
  - The allocated Sales person (or the Host) switches **brands** on or off for each consultant and sets the **commission percentage per brand**. A consultant sees and can sell only activated brands.
  - A consultant creates dealers and orders like Sales, but only for their own dealers. The order then follows the same push to Logistics and Finance process.
  - The allocated Sales person is notified when the consultant creates a dealer, places an order, uploads a payment proof or pushes an order.
  - **Commission** is worked out when the dealer's payment is verified: the brand's percentage on the amount received including GST for that brand's goods, taken back for returned goods. Changing a percentage later never changes commission already earned. The consultant sees it in **Analytics**; their Sales manager, Finance and the Host see it too.
  - **Overview** (Sales and Host): active consultants by zone and city, and a zone x brand table of who can sell what.
- **Google sheets** are now updated **by the server itself**, every 20 seconds when something changed, so they stay current even when nobody has the portal open. Rows Google refuses are kept and retried; the Sheets screen shows the exact reason (for example "the secret in the portal is not the one saved in the script", or "share the Google Sheet with the account that owns the script"). The Field Sales department has its own sheet with the consultants' orders.

## 8. v26: restructured Field Sales, Visits, RTO approval, on-field orders

- **Field Sales Consultants cannot create dealers.** Only Sales or the Host creates a dealer for a consultant (with `salesEmp` set to the consultant's ID). This prevents data entry by people who don't set purchase prices.
- **My Visits:** a field consultant logs dealer visits (purpose, outcome, next step). The allocated Sales person sees them.
- **RTO:** any Sales or Logistics person can request an RTO for a dispatched order. The Host gets an **immediate popup** with Approve / Reject buttons. An approved RTO sets the order status to "RTO".
- **On-field orders section:** Sales, Logistics and Finance each have an "On field orders" section showing orders placed by field consultants. These orders follow the same dispatch chain but stay in the on-field section after delivery.
- **Orders page restructured (Sales):** renamed to "ORDERS" with tabs: Pending orders, Orders (delivered), On field orders, Preorders, Sample orders.
- **Zone for Sales employees:** the Host allocates a zone (North, South, East, West) to each Sales person. Zone-wise data is visible to every Sales person but not to field consultants.
- **Finance:** an on-field commission summary is shown (total commission by consultant this month).
- **Warehouse:** sees all orders in one place (no on-field split).

## 9. v27: Field Sales is its own department

- **Hierarchy.** The Host creates a Field Sales Consultant in **Team** (department "Field Sales Consultants") with a **zone**, a **state inside that zone**, a **city** and a **senior Sales executive** who works in the same zone. Nobody else can create one. Sales executives are given a **zone** (North, South, East, West) when they are created.
- **What a consultant can do:** create dealers (only inside the allocated state: the pincode decides), CRM leads and notes, orders (only for their own dealers and only brands the senior activated), upload payment proofs, log visits, see offers of their senior, inventory, updates, analytics (commission), WhatsApp and attendance. The dashboard is the Sales dashboard.
- **What a consultant can never do:** change, cancel or delete anything once it exists (orders, dealers, leads), set prices, confirm orders, mark an order paid, see any other department. This is enforced three ways: the buttons are not drawn, the data layer refuses, and the server discards any write outside a short allow-list.
- **The senior Sales executive** prices and maintains the consultant's dealers, confirms the consultant's paid orders (which then go on to Logistics and Finance), switches brands on or off with a commission per brand, and sees the consultant's leads, visits, orders and commission. Another Sales executive sees none of that.
- **Commission** is worked out only after Finance has verified the payment (amount received including GST, for that brand's goods, net of returns). A later rate change never alters earned commission.
- **Host:** the **Sales** page shows every zone (tabs North, South, East, West), each Sales executive and the consultants under them, orders, and what was sold by brand. Only the Host approves an RTO; the approval window opens by itself on sign-in.
- **On-field orders** are a separate segment: Sales (tab under Orders), Logistics (third tab beside Orders and Return orders) and Finance (own section with the on-field commission). Delivered on-field orders stay there.
- **Dealers** never receive a staff user ID (replaced by an opaque alias), another dealer's code (post likes show a count only), or any staff-side data. **Nobody** is sent a password or hash; the console never displays one (a new password is shown once, when it is set).
- **Sample data** (demo only; a clean install gets none): 4 consultants in 4 zones, 5 dealers, 9 orders at every stage, 12 CRM leads, 10 visits, an RTO waiting. Logins: FIELD01 to FIELD04 / field123; dealers FDEMO1 to FDEMO5 / fdemo123.

## 10. v28: Google Authenticator, Host-only commission, department-limited screens

**Google Authenticator (every department).** After the password, staff type the 6-digit code from the Google Authenticator app. The server checks it in the same request (no delay); the browser sends it the moment the sixth digit is typed.
- **Default:** required for every department in a real install. In the demo (`SEED_DEMO=1`) it is off unless you set `REQUIRE_2FA=1`. `REQUIRE_2FA=0` switches it off everywhere (not recommended).
- **First time:** the person scans a QR code (or types the key) and enters a code; from then on only the code is asked.
- **Properties:** the secret is stored encrypted (AES-256-GCM with `APP_SECRET_KEY`); a code works once (a reused code is refused); a code from the previous or next 30-second step is accepted for clock drift, older or newer is not; a wrong password never reaches the code step; five wrong codes end that attempt and count toward the same account lockout as wrong passwords; no session and no data are given until the code is right.
- **Host:** the **Security** page switches the rule on or off per department (or for all), shows who has set it up, and **resets** a lost phone (the old authenticator stops working at once and their open session ends). API: `GET /api/security`, `POST /api/security` (`action: policy | reset`). Dealers sign in with their password only.
- **A lost Host phone:** whoever runs the server starts it once with `RESET_2FA_FOR=ADMIN` (comma-separated user IDs allowed); the Host then scans a new QR code. Remove the setting afterwards.
- **Demo browser mode:** the same screens, checked in the browser (the secret lives in that browser). Turn it on per department on the Security page. Known limit: in double-click (file://) mode the browser's own storage is not fully reliable across tabs and reloads, so the demo's authenticator rule can be lost. The secure server stores it safely.

**Field Sales Consultants (changes).** No attendance, no allowances, no Analytics. Menu: dashboard, dealers, offers, inventory (only the brands activated for them, filtered on the server), My visits (they can edit their own), updates, Sheets (their own sheets only), WhatsApp (dealers only). Only the Host can create or change a consultant: HR and everyone else are refused.

**Commission (Host only).** For each consultant and brand the Host chooses: a percentage (up to 30), a fixed amount per order, or order-size slabs (from, up to, percent or amount, value). The senior Sales executive can only switch a brand on or off, and only after the Host has set its commission. Commission is posted only after Finance verifies the payment; a later change never alters what was earned.

**Warehouse.** Inventory is view-only: stock in, out, returned, damaged, adjust and purchases are for Finance and Logistics (and the Host); the Warehouse may only ask for a count. Logistics costs are never sent to the Warehouse. (Receiving a return order is unchanged.)

**Dealers.** A dealer receives no employee information at all (no name, mobile or ID) and never any password or hash.

**Eleven (the assistant).** It speaks only about the user's own department, says what it can do for that department, refuses other departments' topics, and for a consultant covers only their own brands, leads, visits, commission and orders.

**Update pop-up with a preview.** After an update each person sees a pop-up once, with a small preview of what changed for their department. To announce a future update, add an entry at the top of `SEL_RELEASES` in `dealer-portal/js/whatsnew.js` (a new id, the items, and who each item is for). It stays quiet under browser automation unless `sel.v2.forcewhatsnew` is set.

**The RTO approval pop-up.** It stays until the Host decides; "Decide later" is remembered per order for the rest of the session (it used to forget after a reload in demo mode).

## 11. v29: "Shoot to confirm" on every file upload and delete

Every employee file action in the console is now gated by a basketball mini-game (`dealer-portal/js/confirmshot.js`): a card with a hoop appears, and the employee must drag the file (shown as a ball) and shoot it through the rim to confirm. Cancel or Esc aborts and nothing happens; a miss bounces the ball back to try again.

- **Uploads gated:** invoice PDF, e-way bill PDF, payment-proof screenshot, and the Posts banner image. The gate opens the moment a file is chosen / Save is pressed, and the file is only read and saved after a successful shot.
- **Deletes gated:** dealer, offer, CRM lead, courier partner, freebie, and branding posts. The old `confirm()` dialog is replaced by the shot (delete mode shows a red court and a trash ball).
- **Reusable API:** `ConfirmShot.upload({ fileName })` and `ConfirmShot.delete({ fileName })` each return a Promise — resolve on a swish, reject (reason `cancelled`) otherwise. One modal at a time; falls back to running the action directly if the script is absent, so nothing breaks if it fails to load.
- **No new dependencies.** Works with mouse and touch. Loaded from `admin/index.html` before `admin.js`, so both the demo and the secure build get it.

Verified end to end in a real browser: choosing a file opens the gate, a swish completes the upload/delete, and cancelling aborts it with no change.

