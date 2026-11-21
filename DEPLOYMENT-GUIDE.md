# S-ELEVEN: deployment guide (GitHub → Vercel → production server)

## 0. How the pieces fit (read this first)

| Piece | Where it runs | Why |
|---|---|---|
| **Public website** (`www.s-eleven.com`) | **Vercel** (static, free, automatic from GitHub) | It is only web pages. |
| **Dealer portal, employee console, orders, payments, passwords** (`portal.s-eleven.com`) | **Your own server** with Docker (VPS) + PostgreSQL | It is a long-running Node program with a database and secure sessions. **Vercel cannot run it** (Vercel runs short serverless functions, not a program that stays on). |

So the **admin password variable lives on the server**, not on Vercel. Vercel's website does not read any password. Section 4 still shows exactly how to add variables in Vercel in case you want them stored there, and Section 5 shows where the real ones go.

Your private values (admin password, keys) are in `ADMIN-CREDENTIALS.txt` and `4-secure-server/.env`. **Never put either file on GitHub.** The included `.gitignore` already blocks them.

You need: a GitHub account, a Vercel account, a domain you control (e.g. `s-eleven.com`), and a Linux server (Ubuntu 24.04, 2 GB RAM is enough) with a public IP.

---

## 1. Put the code on GitHub

1. On github.com click **New repository** → name `s-eleven` → **Private** → *do not* add a README → **Create**.
2. On your computer, open a terminal in the unzipped `S-ELEVEN-Deployment` folder and run:
   ```
   git init
   git add .
   git status        # CHECK: .env and ADMIN-CREDENTIALS.txt must NOT be listed
   git commit -m "S-ELEVEN first release"
   git branch -M main
   git remote add origin https://github.com/YOUR-USER/s-eleven.git
   git push -u origin main
   ```
3. If `git status` ever shows `.env`, stop and run `git rm --cached 4-secure-server/.env`.
4. On every push GitHub runs the automatic tests (`.github/workflows/ci.yml`). A green tick means the server code passes all tests.

---

## 2. Website on Vercel

1. vercel.com → **Add New… → Project** → **Import** your `s-eleven` GitHub repository.
2. Settings on the import screen:
   - **Root Directory:** `1-website-and-dealer-portal` (click *Edit*)
   - **Framework Preset:** *Other*
   - **Build Command:** leave empty · **Output Directory:** leave empty
3. Click **Deploy**. In about a minute you get a `*.vercel.app` address: open it and check the website.
4. **Domains:** Project → *Settings → Domains* → add `www.s-eleven.com` (and `s-eleven.com`, redirect it to www). Vercel shows the DNS records to create at your domain registrar; use exactly the values Vercel shows (normally: `A  @  76.76.21.21` and `CNAME  www  cname.vercel-dns.com`).
5. The included `vercel.json` already sends `/dealer-portal` and `/access` visitors to the real portal (`portal.s-eleven.com`) so nobody ever sees the demo copy of the portal. If your portal address is different, edit the two `portal.s-eleven.com` lines in `1-website-and-dealer-portal/vercel.json` and push.
6. From now on every `git push` to `main` updates the website automatically.

---

## 3. Production server (the portal)

### 3.1 Prepare the server (once)
```
ssh root@YOUR-SERVER-IP
apt update && apt install -y docker.io docker-compose-v2 git ufw debian-keyring debian-archive-keyring apt-transport-https curl
# Caddy (automatic HTTPS):
apt install -y caddy
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

### 3.2 DNS
At your domain registrar add: **A record** `portal` → `YOUR-SERVER-IP`. Wait a few minutes.

### 3.3 Get the code and the secrets onto the server
```
git clone https://github.com/YOUR-USER/s-eleven.git /opt/seleven     # private repo: use a GitHub token or a deploy key
```
Copy your private `.env` from your computer (it is NOT in GitHub):
```
scp S-ELEVEN-Deployment/4-secure-server/.env root@YOUR-SERVER-IP:/opt/seleven/4-secure-server/.env
chmod 600 /opt/seleven/4-secure-server/.env
```

### 3.4 Start
```
cd /opt/seleven
docker compose -f 4-secure-server/docker-compose.yml --env-file 4-secure-server/.env up -d --build
docker compose -f 4-secure-server/docker-compose.yml logs -f app      # wait for "S-ELEVEN server listening"; Ctrl+C
```
HTTPS: edit `4-secure-server/deploy/Caddyfile` (it already says `portal.s-eleven.com`), then
```
cp /opt/seleven/4-secure-server/deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy
```

### 3.5 First sign-in
1. Open `https://portal.s-eleven.com` + the private employee address in `ADMIN-CREDENTIALS.txt` (looks like `/access/staff-xxxxxxxxxx`).
2. User ID `ADMIN` + the admin password from `ADMIN-CREDENTIALS.txt`.
3. The system asks you to set up **Google Authenticator**: scan the QR with the app and enter the 6-digit code.
4. **Remove the one-time password from the server:** edit `/opt/seleven/4-secure-server/.env`, delete the `INITIAL_ADMIN_PASSWORD=` line, then run the `docker compose … up -d` command again. (The admin password stays stored, encrypted, in the database. Change it later from the Team screen if you wish.)

### 3.6 Set up the business (as ADMIN)
Team (add employees) → Dealers (add dealers and prices) → Logistics (set each partner's rate per kg; they start at 0) → Brands (Admin and IT: *Add brand*, enter the brand website, *Fetch from website*, check prices, save) → Inventory (every product starts at 100 pcs).

### 3.7 Backups (do not skip)
```
crontab -e
0 2 * * * /opt/seleven/4-secure-server/deploy/backup.sh
```
Copy the backup files off the server regularly (another cloud storage or your computer).

---

## 4. Variables on Vercel (step by step)

Vercel project → **Settings → Environment Variables** → *Key* / *Value* → choose **Production** (and Preview if wanted) → tick **Sensitive** → **Save**. Then **Deployments → ⋯ → Redeploy** so the new values apply. You can also paste the whole block from `ADMIN-CREDENTIALS.txt` ("Environment variables" section) into the first box: Vercel splits it into separate variables.

The variables are:

| Key | Meaning |
|---|---|
| `INITIAL_ADMIN_PASSWORD` | the admin (Host) password, used only on the server's very first start |
| `APP_SECRET_KEY` | 64-character key that encrypts stored secrets |
| `DB_PASSWORD` | database password |
| `STAFF_PATH` | the private employee login address |

**Important:** the static website on Vercel does not read these. They only take effect on a host that actually runs the server (Section 3, or a container host such as Render / Railway / Fly.io that deploys from GitHub). Do not rely on Vercel as the only place they are stored: keep the master copy in a password manager.

---

## 5. Where each secret goes

| Secret | Put it here |
|---|---|
| Admin password, APP_SECRET_KEY, DB_PASSWORD, STAFF_PATH | `/opt/seleven/4-secure-server/.env` on the server (chmod 600) and your password manager |
| Nothing secret | GitHub and the Vercel website |

---

## 6. Updating later

- **Website change:** edit → `git push` → Vercel redeploys by itself.
- **Portal change:** `git push`, then on the server:
  ```
  cd /opt/seleven && git pull && docker compose -f 4-secure-server/docker-compose.yml --env-file 4-secure-server/.env up -d --build
  ```
- **Rollback:** Vercel → Deployments → *Promote* an older one; server: `git checkout <older-commit>` and run the same `up -d --build`.

---

## 7. Go-live checklist

- [ ] GitHub repo is **private**; `.env` and `ADMIN-CREDENTIALS.txt` are not in it
- [ ] `https://www.s-eleven.com` shows the website
- [ ] `https://www.s-eleven.com/dealer-portal/` redirects to `https://portal.s-eleven.com/dealer-portal/`
- [ ] The private employee address works; `/admin/` and `/employee/` give *not found*
- [ ] ADMIN signed in, Google Authenticator set, `INITIAL_ADMIN_PASSWORD` removed from `.env`
- [ ] First dealer added; test order → dealer pays by QR + screenshot → Finance taps **Payment verified** → invoice attached → Warehouse packs → Logistics dispatches
- [ ] Logistics rates set; backup cron running and a backup copied off the server
- [ ] Payment screen shows the bank account number / IFSC (fill `PAYTO` in `dealer-portal/js/app.js` if you want them shown, then push and redeploy)

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Server will not start: "First start: set INITIAL_ADMIN_PASSWORD" | `.env` is missing or the line was removed before the very first start |
| Portal shows certificate error | The `portal` DNS A record is not pointing to the server yet, or ports 80/443 are closed |
| Cannot sign in, lost authenticator phone | On the server add `RESET_2FA_FOR=ADMIN` to `.env`, run `up -d`, sign in, set up again, then remove that line |
| Vercel build fails | Root Directory must be `1-website-and-dealer-portal`; Framework *Other*; Build Command empty |
| Brand fetch finds no products | Some sites hide their product list; add the products by hand in the same form |
