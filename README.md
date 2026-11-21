# S-ELEVEN website, dealer portal and admin console

- `1-website-and-dealer-portal/` public website (deploy to Vercel, Root Directory = this folder)
- `4-secure-server/` secure server: dealer portal, admin console, orders, payments (deploy with Docker; see DEPLOYMENT-GUIDE.md)

No demo data and no default passwords are included. The system starts empty: the ADMIN login, every product at 100 pcs, no dealers, employees or orders. The ADMIN password is the `INITIAL_ADMIN_PASSWORD` variable you set in your hosting dashboard. Never commit a `.env` file.
