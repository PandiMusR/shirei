FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/runner/package.json apps/runner/package.json
COPY apps/app/package.json apps/app/package.json
RUN npm ci -w apps/runner
COPY tsconfig.base.json ./
COPY apps/runner apps/runner
RUN npm run build -w apps/runner

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 agent \
 && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash agent \
 && mkdir -p /workspace /home/agent/.cursor /home/agent/.config /home/agent/.cache /opt/shirei \
 && chown -R 10001:10001 /workspace /home/agent /opt/shirei
WORKDIR /opt/shirei
COPY package.json package-lock.json ./
COPY apps/runner/package.json apps/runner/package.json
RUN npm ci --omit=dev -w apps/runner --include-workspace-root=false \
 && npm cache clean --force
COPY --from=build /src/apps/runner/dist ./dist
ENV HOME=/home/agent \
    PATH=/home/agent/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOST=0.0.0.0 \
    PORT=8787 \
    WORKSPACE_ROOT=/workspace
USER agent
RUN curl https://cursor.com/install -fsS | bash
EXPOSE 8787
CMD ["node", "/opt/shirei/dist/index.js"]
