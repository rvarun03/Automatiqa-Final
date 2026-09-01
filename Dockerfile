# syntax=docker/dockerfile:1

# Stage 1: Base & Build
FROM node:20-bookworm-slim AS builder

# Install system libraries needed for build tools and Playwright browser support
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-liberation \
    libx11-xcb1 \
    libxcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Configure shared Playwright browser cache location
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package manifests first for optimal layer caching
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci || npm install

# Copy application source code
COPY . .

# Build the client SPA and bundled backend server into dist/
RUN npm run build

# Download Playwright Chromium binaries for headless recording/automation
RUN npx playwright install chromium chromium-headless-shell && \
    chmod -R 777 /ms-playwright

# Stage 2: Production Runtime
FROM node:20-bookworm-slim AS runner

# Install runtime OS dependencies required by Playwright Headless Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-liberation \
    libx11-xcb1 \
    libxcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package manifests and runtime dependencies
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=builder /ms-playwright /ms-playwright

# Copy local fallback JSON files used by the application
COPY --from=builder /app/users.json ./users.json
COPY --from=builder /app/projects.json ./projects.json
COPY --from=builder /app/notifications.json ./notifications.json
COPY --from=builder /app/activities.json ./activities.json

# Expose web application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) process.exit(1)});" || exit 0

# Start server
CMD ["node", "dist/server.cjs"]
