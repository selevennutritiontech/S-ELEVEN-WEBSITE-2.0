# S-ELEVEN Nutrition website

- `index.html` - main website (single file, images embedded). Footer has the Dealer Login link.
- `creator-programme/` - Athlete & Creator Programme page and team dashboard
- `employee/` - Employee Portal index page (sign-in + department tiles: Host, Sales, Logistics, Warehouse, Finance)
- `dealer-portal/` - Dealer Portal (login, Generate Order, My Orders + tracking, Offers, Updates, Eleven assistant) - DEMO PREVIEW
  - `dealer-portal/admin/` - Admin console (dealers + purchase prices, offers with expiry, logistics + tracking) - not linked from the website
  - `dealer-portal/js/db.js` - demo "backend" (browser storage); replaced by the real backend later
  - `dealer-portal/js/docs.js` - Sales Order / Tax Invoice documents (GST split)
  - `dealer-portal/js/config.js` - set AI_ENDPOINT here to switch Eleven to the real AI service
  - `dealer-portal/img/` - product photos (from the brand catalogues)
  - `dealer-portal/catalogues/` - brand catalogue PDFs shown on the login page
- `backend/assistant-worker.js` + `assistant-system-prompt.txt` - Eleven AI backend (Cloudflare Worker, needs an API key)
- `backend/worker.js` - Cloudflare Worker for creator applications (deployed on Cloudflare, not Vercel)
- `vercel.json` - hides `/backend` and this README from the public website


## Update: staff security, new menus, IT department
- Employees sign in with **user ID and password only** (the Google Authenticator step is switched off for now; set `REQUIRE_2FA: true` in `dealer-portal/js/config.js` to bring it back). The authenticator code stays in browser; the live platform stores them encrypted on the server.
- Admin menu: Overview, Team, Dealers, Inventory, Posts, Logistics, Warehouse, Finance, HR. Sales extras (Targets, Freebies, Offers, Preorders, Samples) live under Team > Sales.
- Warehouse and Logistics: Orders, Inventory (In / Out / Damaged / Returned), Sample orders, Attendance. Pending work shows yellow, then red.
- Invoices are uploaded manually by Logistics; above 50,000 an e-way bill is also required before dispatch.
- HR: Google-style attendance calendar. New IT department with tasks. Eleven assistant for employees.
- Platform core (folder 2): 68 tests, 63 tables, restore drill passes.


## Update 3: payments, batches, returns, ledgers, filters (screens run on browser demo storage)
- **Work period filter** on every department screen: pick a month or a date range (or All time).
- **Payments:** Logistics can no longer mark an order paid. Sales and Finance upload a payment screenshot with the UTR; Finance verifies it (not the uploader); Logistics only views it. Part payments work.
- **Orders** show who generated the order and the Sales employee; the status is the one Logistics sets. **Warehouse seen ticks** (like WhatsApp) show to Host, Finance, Logistics and Sales.
- **Inventory by batch:** Stock In needs batch number, manufacturing and expiry dates; Stock Out takes the earliest expiry first; filter by batch number or state (expiring, expired, quarantined). Counts and adjustments are requests approved by Finance.
- **Returns and inward** (Finance, Warehouse receives), **dealer ledgers** with credit and debit notes (only Finance posts, corrections are reversals), dealer-visible return status and statement, **Sales incentive report** (Finance and Host only, Host sets rates), **Pending orders / SO** for Sales, preorders visible to Finance, Sales and Logistics.
- Attendance now starts when an employee signs in and ends when they sign out. Closing a tab is not a sign-out.
- The Host role cannot be created through employee management.
- All old demo data was erased; 15 new DEMO orders (3 each for Warehouse packing, Logistics, Finance proofs, Sales pending, Returns) and 3 preorders are created once on first load.


## Update 4: department structure (demo screens)
- **Sales:** My dashboard, Create order (Forward or Return order; a return needs Host or Finance approval), Pending orders / SO (orders, preorders, sample orders; Collect payment by Razorpay QR / card link / UPI request, or a manual screenshot or UTR; Confirm order), Dealer ledgers, Offers, Freebies, Inventory, Preorders (create, move to pending), Samples, My attendance.
- **Logistics:** Orders (Orders, Return orders with RTO booking and pickup tracking; invoice and e-way bill beside every order), Inventory, Sample orders (attach the invoice, then Warehouse packs), Attendance. A paid order reaches Logistics and Warehouse only after Sales confirms it.
- **Warehouse:** Orders (Orders, Return orders, Samples), Inventory, Attendance. The shift can be closed with orders pending and must be closed before signing out.
- **Finance:** Finance (with the Sales employee of each dealer), Orders & payments (edit payment proofs and photos with an audit trail, view Razorpay receipts, attach invoices), Returns & inward (Host or Finance approves; credit note or replacement), Dealer ledgers, Sales incentives (rates only by the Host; paid only when the target is met), Inventory, Attendance.
- Razorpay here is a **demo simulation**. The live platform needs a Razorpay account, Orders / Payment Links APIs and the verified webhook.


## Update 5: RTO analysis, inward checklist, purchase PDF, edits, GST (demo screens)
- **Finance > RTO analysis:** Taxable value, CGST, SGST, IGST and Total, each as Sales minus RTO equals Remaining. Count approved returns, goods the Warehouse verified, or credit notes issued. GST follows the original sale: Gujarat is CGST + SGST, other states IGST.
- **Warehouse inward checklist:** the Warehouse counts and classifies returned goods by batch. The credit note (Finance or Logistics) is for the verified quantity only, GST included, and the dealer sees it in the ledger and Returns page.
- **Inventory:** Warehouse now has the same stock options as Logistics. Finance can upload a purchase order PDF (try `samples/sample-purchase-order.pdf`); the portal reads it, shows it brand by brand for review, and inwards the stock as new batches. Text-based PDFs only.
- **Sales have the Dealers tab.** Only the Host changes a dealer's assigned Sales employee (who gets the target credit).
- **Filters** on orders, pending payments, returns, preorders and samples in every department (search, dealer, status, payment, Sales employee) together with the work-period filter.
- **Order edits:** products can be changed until payment; for 24 hours after payment the dealer or Sales can add products and pay only the difference, after which the order is locked. Carts say orders are dispatched within 36 hours of payment.
- **GST:** a GSTIN must match the pincode's state; a blank GSTIN is an Unregistered profile. Tax follows the delivery state.


## Update 6: inventory by flavour, freight, preorders, attendance, analytics (demo screens)
- **Inventory** is separate for every flavour and pack, and can be viewed flavour-wise or pack-wise and filtered by type (powders and others / packs and bars / capsules, tablets and softgels). Stock in needs the flavour. Items added from a purchase order or bill show a **NEW** mark for 72 hours.
- **Purchase bill PDF:** the portal reads the bill/PO number, supplier, product, flavour, batch, manufacturing and expiry dates and quantity (dates like 03/2026 or Aug 2028 are understood). You review before stock is inwarded.
- **Ordering:** the flavour you pick shows its own stock; a sold-out flavour offers a preorder and cannot be over-ordered.
- **Freight:** added to each order by order size (Host can edit the slabs); each dealer has an "Apply freight" switch.
- **Preorders:** several products in one preorder, editable until stock is reserved, with a timeline (Sales and dealer portal).
- **Dealers (Sales and Host):** filters by state, city and Sales employee.
- **Attendance:** sign-in when the portal opens, sign-out when the tab is closed (or when you sign out); anyone can sign out any time; HR can sign any employee in or out. My attendance has a month calendar with day details, plus petrol allowance (Rs 3.5 per km, automatic) and reimbursements with optional receipts; allowance days are marked on the calendar; the Host approves them in HR.
- **Analytics** for every department and employee, with line and bar charts, filters and (for Sales) a scored performance report.


## Update 7: Eleven AI assistant can now take actions (employee console)
Open the assistant (bottom-right) and type naturally:
- **Navigate:** "open finace", "go to the Dealers tab", "take me to inventry", "open my attendance", "go back to the dashboard", "open order details for order DEMO-S1". It opens only pages your role may open; otherwise it says you do not have access. It never invents a page.
- **Preorder:** "Generate a preorder of massgainer for DEMO001". It asks only for what is missing (brand, pack, flavour, quantity), shows live stock for each flavour, understands "10" as the quantity, lets you change or cancel, shows a summary, and creates the preorder only after you press Confirm. It uses the existing preorder service, so price and rules are the system's. A second Confirm cannot create a second record.
- **Spelling:** typo-tolerant matching against the real catalogue, brands, flavours, dealers and pages. Unknown names (for example a brand that is not in the catalogue) are never invented: the assistant lists the real options. Pack sizes and strengths must match exactly.
- Files: js/agent.js (tools and conversation), js/staffai.js (chat panel). The audit log of AI actions is kept in the browser here and goes to the server audit table when the live platform is connected.


## Update 8: HR role, salary and slips, one order process, alerts, vertical menu, freebie wallet
- **HR department:** the Host can create HR employees. HR (and the Host) set salaries and the overtime/holiday rules, and approve allowances. Nobody else can change a salary.
- **Salary:** daily salary = monthly / days in the month. Late arrival is deducted per minute (daily / 480). Absent days are unpaid. Warehouse: every hour (by the minute) signed in after 7 PM pays Rs 80; working on a holiday earns 1.5x the daily salary (rules are editable per department in HR > Salary). The calendar shows each day's pay with its breakdown.
- **Salary slip:** released automatically on the 2nd of every month into each employee's My attendance tab (View / print / save as PDF). In this browser demo the release happens when anyone opens the portal on or after the 2nd; the live server does it with a scheduled job.
- **One order process, same stage everywhere:** Order placed > Payment confirmed > Pushed to Logistics and Finance > Invoice (and e-way bill) uploaded > Warehouse packing > Packed: ready for pickup > Dispatched > Delivered. The same 8-step bar is shown to the dealer, Sales, Logistics, Finance, Warehouse and Host. The Warehouse sees an order only after the invoice (and e-way bill when needed) is uploaded.
- **Pop-ups and alerts:** payment confirmed asks Sales to Push or Revise; push alerts Logistics and Finance; invoice upload alerts the Warehouse; packing alerts Logistics and Finance and updates the status. Alerts stay on screen, and a desktop notification repeats every 10 minutes, until you press Task completed. Alerts work while the portal is open; on Android they use the service worker (sw.js) and need the site served over https.
- **Revise a paid order before it is pushed:** raise it (pay the difference) or lower it; the extra paid returns as a credit note in the dealer ledger once the dealer or Sales confirms.
- **Freebie wallet:** the unused part of the freebie allowance carries to the dealer's next order.
- **Vertical menu** for every department (a slide-out menu on phones). Edit order now shows on every order in Pending orders.


## Update 9: one alert bell, 8-step order status, freight by Sales, zones and categories, new look
- **Alerts in one place:** only the bell beside Logout (every department). It lists every alert with Task completed; desktop notifications and the 10-minute reminders continue until it is completed.
- **Order status (same for the dealer, Sales, Host, Logistics, Finance and Warehouse):** Order generated > Payment confirmed > Waiting for invoice > Warehouse preparing your order > Order being packed > Ready to be picked up > Order in transit > Delivered. The Warehouse has a Mark dispatched button once an order is packed (Logistics and Finance are alerted to add tracking); Logistics gets Mark delivered once tracking is entered. The status is shown as a thin bar with its name, not big dots.
- **Freight:** the Apply freight charge control is on every order Sales creates (slab amount, or type an amount) and in the dealer form (apply, optional fixed amount). Dealers cannot change it.
- **Create order page:** products first; order history and analytics at the bottom, with search by name, order number, product, amount, status and payment.
- **Zones and categories:** every dealer has a category (Distributor, Wholesaler, Retailer, Gym, Solo buyer; required) and a zone (North, South, East, West) picked automatically from the pincode and state. Zone and category filters are in the Dealers tab and in every order filter bar; the Dealers tab has a zone x category table.
- **Look:** bright blue menu with a white active tab, gradient summary cards, card-style rows, navy buttons; chart colours follow the same palette.
- **Eleven AI:** the robot icon, with a new suggestion about every minute in the employee console and the dealer portal.


## Update 10: fixed header and menu, glass icons, carousel scroll
- The top header and the vertical menu no longer move when the page scrolls; only the page content scrolls. The menu sits directly under the header at all times.
- Every menu item has its own icon. The selected item and its icon are frosted glass.
- Apple-style carousel scroll: scrolling the menu (mouse wheel or touch) makes the item in the centre full size while the others tilt away, shrink and fade; choosing a tab glides it to the centre. Turned off automatically for people who set "reduce motion" on their computer.


## Update 11: the live bot, and starting from zero
- **Eleven is now a live bot** (employee console and dealer portal): it floats, waves, turns toward your cursor, and flies to things to point them out. Ask "Where is Finance?", "How do I find Dealers?" or "Give me a tour" and it flies to the menu item, rings it and explains it (Next / End tour). When you ask it to open a page it shows where that page sits in the menu; when a new alert arrives it points at the bell.
- **Start from zero:** all sample employees, dealers, orders, stock, ledgers, offers, posts and records are gone. Only the Host login (ADMIN, password set on the server as INITIAL_ADMIN_PASSWORD), the product catalogue and the settings (freight slabs, holidays, leave and salary rules, couriers) remain. A browser that already holds old sample data is cleaned once, the first time this version opens in it (CLEAN_START_ID in js/config.js; change it to wipe again).
- Erase and sample-data buttons no longer exist: the system always starts clean (Host login, every product at 100 pcs, no dealers, employees or orders).


## Update 12: activate / deactivate products, fixed menu, glass tail
- **Inventory > Activate / Deactivate product** (on every product's heading; Host, Finance, Logistics and Warehouse). An inactive product is hidden from dealers and from every employee screen (dealer portal, Create order, preorders, the assistant, other departments' stock views). Inventory managers still see it, marked Inactive, with a filter (Active and inactive / Active only / Inactive only) and an Inactive products count, so it can be switched back on. Existing orders and ledgers that contain it are unaffected; a cart that still holds it cannot be paid for.
- **The menu is fixed:** no scrolling, no carousel movement. Every item is always visible; on short screens the items compact. The TEST MODE bar, the header and the menu are all pinned and never move when the page scrolls.
- **Glass tail:** the selected tab is frosted glass that flows into the glass page with curved tails above and below, as in the reference design; its icon is a glossy glass tile.
- **Fixed:** an order placed by a dealer now carries the freight shown in the cart (previously only the cart screen showed it).


## Update 13: dealer login details (view and reset)
- **Dealers > Edit** now has a **Login details** section: the dealer's User ID (with Copy), the current password (hidden, with Show and Copy), a New password box with **Generate** (10 characters, always with an uppercase letter, a lowercase letter and a digit), and **Reset password now**, which changes it immediately and shows the new password to share. The old password stops working at once. The section also shows when and by whom the password was last changed.
- Who can see and reset: the Host and the Sales employee the dealer is assigned to. Other employees (including Finance) cannot. Each reset is recorded in the activity log.
- The Create dealer form has the same User ID and password fields, with Generate.
- Note: this demo stores passwords as plain text in the browser so the Host can show them. The live platform should store only salted hashes and use a one-time "set a new password" link instead of showing passwords.


## Update 14: stage-wise order actions, partner rates by weight, ex-employees
- **Orders (Logistics, and Finance/Host in Orders & payments):** every order has a 3 x 3 action grid. Column 1: SO, Invoice, E-way bill. Column 2: Add tracking, Packing note, Dispatch from. Column 3: Share order, View details.
- **Buttons open stage by stage:** after payment, Invoice, E-way bill, Packing note and Dispatch from open. Add tracking opens only when the Warehouse marks the order Ready to be picked up. Once the order is in transit everything is open. SO, Share order and View details are always open.
- **Invoice / E-way bill:** click an attached one to View or Replace. **Share order** shares the most recently uploaded document (SO, invoice or e-way bill). **View details** opens a centred pop-out with documents, payment receipt or screenshot, dispatch, tracking and packing instructions.
- **Packing note:** the Warehouse is alerted and the note shows on the order row.
- **Logistics partners by weight:** DTDC 70, Tirupati 47, Trackon 50, VXpress 8, iThink 70 per kg (editable on the Logistics page). Order weight is worked out from each product's pack size (LB, kg, g, ml exact; capsules, tablets, servings and packs estimated; every product weight can be corrected under Product weights). Dispatch from shows weight x rate for each partner. This is an internal logistics cost and is not charged to the dealer. The dealer cart and the Sales order screen show the estimated shipping weight.
- **Team > Ex-employees:** add a record for someone who left earlier, or mark a current employee as an ex-employee from their profile (choose who takes over their dealers). They can no longer sign in; details, salary slips and history are kept. Reinstate is available for people who had a portal login. Host and HR only.
- Courier tracking links for the four new partners are samples. Confirm them in Logistics > Courier partners.


## Update 15: orders appear only when pushed, Sheets, WhatsApp
- **Order visibility.** Until payment is confirmed or a payment proof is uploaded by Sales, an order is invisible to Finance, Logistics and the Warehouse. Finance sees an order once a payment proof is uploaded (so it can verify the money) or once Sales pushes it. Logistics sees it only after Sales pushes it. The Warehouse sees it only after Logistics or Finance has verified the invoice and pushed it to the Warehouse.
- **Pop-ups.** When Sales pushes an order, Logistics and Finance get a "New order received" pop-up. When the invoice is verified and pushed, the Warehouse gets the same pop-up.
- **Verify and push to warehouse.** After the invoice (and e-way bill above 50,000) is uploaded, Logistics, Finance or the Host sees "Verify and push to warehouse" on the order. It shows the invoice, e-way bill, dispatch partner and packing note, and needs a tick-box. Stage 4 (Warehouse preparing your order) starts only after this push. Orders that already had an invoice before this update are treated as pushed.
- **Sheets (menu for every role).** A spreadsheet inside the portal: one workbook per department and one personal workbook per employee (the Host sees all). New orders, payments (reference, method, amount, who verified), pushes, invoices, dispatch partner, tracking and delivery are written to the right sheets automatically; each department only gets the rows it may see. Formulas (SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, ROUND, ABS, IF, IFERROR, AND, OR, NOT, CONCAT, UPPER, LOWER, LEN, TRIM, LEFT, RIGHT, TODAY, NOW, SUMIF, COUNTIF, VLOOKUP), add/delete rows and columns, sort, find, undo/redo, copy/paste, number formats, bold, CSV import/export. The automatic columns are locked; add your own columns beside them.
- **Google Sheets.** (1) **Link a Google Sheet**: paste a link (best: File > Share > Publish to web) and it is shown inside the portal, with no new tab. (2) **Connect Google** (Host): optional; sends every automatic row to real Google Sheets through the Apps Script in `2-operations-platform-core/google-sheets` (setup guide there). Rows wait in the browser and are sent when online.
- **WhatsApp (menu for every role).** WhatsApp does not allow its page to be placed inside another website, so each person signs in to their own WhatsApp once (QR code) in one dedicated WhatsApp tab. Every Share button and every "Chat on WhatsApp" button reuses that same tab. The WhatsApp page also lists dealers with one-click chat and message templates.


## Update 16: suspend or transfer, dealer on/off, incentives by brand, news and events, WhatsApp, Eleven, Sales menu
- **Suspend or internal transfer (Host, HR).** In Team, the Suspend button asks for a reason and whether to **Suspend** or make an **Internal transfer**. Suspend: the person cannot sign in; the reason, optional proof (photo or PDF) and notes are kept under **Team > Ex-employees** (shown as Suspended) and they can be reinstated. Transfer: pick the department (and optionally a new designation); the person appears in that team, signs in with that department's access, and the transfer is recorded on their profile. A Sales employee who handles dealers needs a successor chosen first.
- **Dealers: Activate / Deactivate.** Every dealer in the list has a button (a reason is needed to deactivate). A deactivated dealer cannot sign in (they are told the account is deactivated), is signed out if already inside, and Sales cannot create orders for them. Host and the dealer's own Sales employee can do this.
- **Incentive percentage by brand (Host).** Team > Sales: choose a brand and set its percentage. It is worked out on the amount received including GST (net of returns), for a brand whose target the salesperson has met. Estimates are payable only after the Host approves them. Finance sees the percentages but cannot edit them.
- **News and events for employees.** Branding, IT or the Host post news or events (events need a future date). Employees see **Latest news and upcoming events** in My attendance, soonest event first.
- **WhatsApp.** Every department has **Message a dealer** and **Message an employee** side by side (Warehouse has only Message an employee). All chats go into one WhatsApp tab that the portal opened and reuses. A browser cannot take over a WhatsApp tab it did not open, and WhatsApp allows one Web session per browser, so close any separate WhatsApp Web tab and press Open WhatsApp once. Alternatively choose **WhatsApp Desktop app** under "How chats open": chats then go to the signed-in desktop app and no tab opens.
- **Eleven (AI agent).** Can open Sheets (or a particular sheet and tab, for example "open the finance sheet payments"), open WhatsApp, and write WhatsApp drafts from real data (payment reminder, order update, offers, thank you); "open draft" opens it in WhatsApp for you to send. It never sends a message itself.
- **Sales navigation.** For Sales only, CREATE ORDER, PENDING ORDERS/SO, PREORDERS and SAMPLES moved to a fixed horizontal menu in the same blue (not scrollable or movable); the vertical menu has the rest. On phones the four items are equal buttons under the header.
- **Phone.** Pop-up controls are tap-sized, and the new pages were checked at 390 px width for sideways scrolling and button size.


## Update 17: attendance follows the portal tab, order tracker sheet, filters, Google link per department, WhatsApp helper
- **Attendance.** Signing in to the portal signs the employee in; logging out signs them off; closing the tab signs them out at once (a reload within 30 seconds puts the session straight back); locking the screen keeps them signed in (a hidden tab is slowed by the browser, so the portal waits 6 minutes without a signal before treating the computer as off). If the computer is switched off or sleeps, the sign-out is recorded at the last signal; if the tab is still open afterwards a new session starts and the gap is not counted. Payroll uses these sessions.
- **Office time 9:30 AM to 6:30 PM.** No salary deduction if the employee signs in by 10:00 AM. After 10:00 AM, salary is deducted for every minute (counted from 10:00), at daily salary / 480 per minute. Arriving between 9:30 and 10:00 is shown as late for information only.
- **Sheets: Order tracker (Host).** The Company workbook starts with an Order tracker: every order with its payment status, stage, the next pending step, who it is waiting on, and the nine steps (payment, push to Logistics/Finance, invoice, e-way bill, verify and push to Warehouse, packing, tracking, dispatch, delivery) ticked with their dates.
- **Sheets: Logistics Shipments** now shows the courier partner name, tracking ID and a tracking link, updated automatically.
- **Sheets: Filter.** Every sheet has a Filter button: a filter box under every column (text, or operators like >5000, =Paid); several filters combine; the cross clears them.
- **Google Sheet per department.** Sheets > Google backup: each department links its own Google Sheet (shared as Editor with the Google account that owns the script). Every row for that department is then written there automatically and existing data is copied on linking. Until a department links, it sees a reminder banner and a one-time pop-up (only after the Host has connected Google). If the portal's server is down or lost, the data already sent is safe in the Google Sheets; while Google is unreachable, rows wait in the browser and are sent later. See `2-operations-platform-core/google-sheets/README.md`.
- **WhatsApp Helper extension** (`3-whatsapp-extension`, steps in its README). Without it, a web page cannot reuse a tab it did not open, so each chat opens a new tab. With it installed (Chrome, Edge, Brave; Safari on Mac after a one-time Xcode conversion) every Share and Chat goes into the WhatsApp Web tab you already have open. iPhone, iPad and Android open the WhatsApp app directly. The WhatsApp Desktop app option is still available.
