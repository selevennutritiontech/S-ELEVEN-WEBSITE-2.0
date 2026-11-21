# Google Sheets connection (optional)

The portal already has its own **Sheets** section that works offline: one workbook per department and per user,
with orders and payments filled in automatically. This optional step ALSO writes the same automatic rows into real
Google Sheets, so the data is available in Google Drive too.

What gets written, and where
- One Google Sheets **file** per workbook, inside a Drive folder called **S-ELEVEN Sheets**:
  `Sales sheets`, `Finance sheets`, `Logistics sheets`, `Warehouse sheets`, `Company (Host) sheets`, and a personal
  `My sheets: <user>` file for each person.
- One **tab** per sheet: Orders, Payments, Invoices, Shipments, To pack, Packed and dispatched, Activity.
- A new order, a payment (reference, amount, method, who verified), the push to Logistics/Finance, the invoice,
  the push to the Warehouse, dispatch partner and tracking, and delivery all land in the right file and tab.
  A row is **updated** when its Order ID already exists, so you never get duplicates.
- Each department only receives the rows it is allowed to see (for example Finance gets an order only after Sales
  pushes it or a payment proof is uploaded; the Warehouse only after the invoice is verified and pushed).

Setup
1. Sign in to Google with the account that should own the files. Open https://script.google.com and create a **New project**.
2. Replace everything in `Code.gs` with the contents of the `Code.gs` file in this folder.
3. In the line `PropertiesService...setProperty('SECRET', '...')` (function `setSecret`) put a long random text, then choose
   `setSecret` in the function list at the top and press **Run** (accept the permission screens). Keep that text.
4. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Press **Deploy**, accept
   permissions and copy the **Web app URL** (it ends with `/exec`).
5. In the portal sign in as Host > **Sheets > Connect Google**. Paste the URL and the same secret text, press **Save**,
   then **Send a test row** (a file called `Company (Host) sheets` with a `Test` tab appears in the Drive folder),
   then **Send everything now** to copy the existing rows.

Notes
- The portal sends rows from the browser of whoever performs the action. If someone is offline, the rows wait in that
  browser and are sent when it is online again. Press **Send everything now** any time to re-send everything; existing rows are updated, not duplicated.
- The secret protects the web app from strangers. Do not share it. If it leaks, change it in `setSecret`, run it again, and update the portal.
- This is the demo-stage connection. For the live platform the server (not the browser) should call the Google Sheets API
  with a service account, so rows are written even when nobody has the portal open.

## Every department links its own Google Sheet (recommended: a safe copy of the data)
After the steps above, in the portal go to **Sheets**. Every department sees a reminder until it has linked its sheet:
1. The department opens (or creates) a Google Sheet and presses **Share**, giving **Editor** access to the Google account that owns the script
   (the Host enters that account's email under **Connect Google**, and the portal shows it to the departments).
2. In **Sheets > Google backup**, press **Link a Google Sheet** and paste the sheet's link, then **Send test row**
   (a tab called "Connection test" appears in the sheet).
3. From then on every order, payment, push, invoice, dispatch, tracking and delivery for that department is written into that sheet
   automatically (tabs are created for Orders, Payments, Invoices, Shipments and so on). Existing data is copied when the link is saved.
If the portal's server is ever down or lost, the data already sent is safe in those Google Sheets. While Google cannot be reached,
new rows wait in the browser that made the change and are sent when it is online again.
If the sheet was not shared with the script's account, the script reports it back in its response and that sheet is skipped (the others still work).

Linking an existing Google Sheet so it can be **viewed inside the portal** needs no setup: Sheets > **Link a Google Sheet**,
paste the link (best: File > Share > **Publish to web**, view only).
