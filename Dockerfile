# Install the browser through the exact playwright-core in package-lock.json.
FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/witnessqa-browsers
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && node node_modules/playwright-core/cli.js install --with-deps chromium \
    && npm cache clean --force && rm -rf /var/lib/apt/lists/*
COPY cli.mjs ./
COPY worker/src ./worker/src
RUN ln -s /app/cli.mjs /usr/local/bin/witnessqa \
    && chmod +x /app/cli.mjs && mkdir /work && chown node:node /work
USER node
WORKDIR /work
ENTRYPOINT ["witnessqa"]
