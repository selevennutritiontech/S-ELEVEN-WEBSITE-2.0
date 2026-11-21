# S-ELEVEN secure portal server. Build context = the whole package folder. It serves the website at /, the dealer portal at /dealer-portal/
# and the employee login ONLY at the private address STAFF_PATH (default /access/employee-server).
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 SITE_DIR=/app/site
WORKDIR /app/server
COPY 4-secure-server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY 4-secure-server/src ./src
COPY 1-website-and-dealer-portal /app/site
RUN addgroup -S sel && adduser -S sel -G sel && chown -R sel:sel /app
USER sel
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/ping || exit 1
CMD ["node", "src/server.js"]
