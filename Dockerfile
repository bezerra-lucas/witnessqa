# Cloud-ready runner: GitHub Action uses this same CLI.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY cli.mjs ./
COPY worker ./worker
COPY action ./action
RUN npm link
WORKDIR /work
ENTRYPOINT ["witnessqa"]
