FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/app/package.json apps/app/package.json
COPY apps/runner/package.json apps/runner/package.json
RUN npm ci -w apps/app
COPY tsconfig.base.json ./
COPY apps/app apps/app
RUN npm run build -w apps/app

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/data/shirei.db \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /src/apps/app/dist ./dist
COPY apps/app/drizzle ./drizzle
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/index.js"]
