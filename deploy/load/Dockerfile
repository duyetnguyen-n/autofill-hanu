# Isolated load-test server only. Never use this image for the real website.
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY src ./src
COPY manager ./manager
COPY supabase ./supabase
COPY tests/cloud/fixture.ts ./tests/cloud/fixture.ts
COPY scripts/cloud-load-*.ts ./scripts/
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "node_modules/tsx/dist/cli.mjs", "scripts/cloud-load-server.ts"]
