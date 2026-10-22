FROM node:24-bookworm-slim AS builder
WORKDIR /app
# Runner downloads are built here; no changes to the existing extension.
RUN apt-get update && apt-get install -y --no-install-recommends zip unzip && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node scripts/build-cloud-server.mjs && node scripts/package-hcmue.mjs && node scripts/package-chinesetest.mjs --all-platforms

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/build/cloud-server ./build/cloud-server
COPY --from=builder /app/build/cloud-extension ./build/cloud-extension
COPY --from=builder /app/build/cloud-ui ./build/cloud-ui
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz',{headers:{Host:new URL(process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL).host}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","build/cloud-server/main.mjs","--serve-cloud"]
