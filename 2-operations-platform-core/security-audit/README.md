# Security audit tests
`attack-tests.py` reproduces the findings (S1 to S11) against a COPY of the demo; `regression-tests.py` proves the fixed ones stay fixed.
Needs Python + Playwright (`pip install playwright && playwright install chromium`) and the portal served locally:
`cd 1-website-and-dealer-portal && python3 -m http.server 8766 --bind 127.0.0.1`. They change only that copy's browser storage. Never point them at production.
Backend tests: `cd 2-operations-platform-core && npm ci && DATABASE_URL=postgres://... npm run db:migrate && npm test` (needs PostgreSQL).
