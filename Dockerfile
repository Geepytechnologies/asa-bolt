FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.ts ./
COPY src ./src
COPY shared ./shared
COPY assets ./assets
COPY public ./public
RUN npx vite build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production ASA_BOLT_HOST=0.0.0.0 ASA_BOLT_PORT=8787 ASA_BOLT_STATIC_DIR=/app/dist ASA_BOLT_DATABASE_PATH=/app/data/asa-bolt.sqlite ASA_BOLT_BACKUP_DIR=/app/backups
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p data backups && chown -R node:node /app
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node scripts/database-backup.ts ./scripts/database-backup.ts
COPY --from=frontend --chown=node:node /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
