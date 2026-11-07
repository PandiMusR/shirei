FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/app/package.json apps/app/package.json
COPY apps/runner/package.json apps/runner/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci -w apps/app -w apps/web
COPY tsconfig.base.json ./
COPY apps/app apps/app
COPY apps/web apps/web
RUN npm run build -w apps/app && npm run build -w apps/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/data/shirei.db \
    MIGRATIONS_DIR=/app/drizzle \
    WEB_ROOT=/app/web
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/app/package.json apps/app/package.json
RUN npm ci --omit=dev -w apps/app --include-workspace-root=false \
 && npm cache clean --force
COPY --from=build /src/apps/app/dist ./dist
COPY --from=build /src/apps/web/dist ./web
COPY apps/app/drizzle ./drizzle
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/index.js"]
