# Backend Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install pnpm and required tools
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies (backend only)
RUN pnpm install --frozen-lockfile --filter "slack-connector"

# Copy backend source
COPY src/ ./src/
COPY tsconfig.json ./

# Create necessary directories
RUN mkdir -p /root/.claude-gateway

# Environment variables
ENV NODE_ENV=production
ENV WS_PORT=4900
ENV ENABLE_SLACK=false

# Expose WebSocket port
EXPOSE 4900

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4900 || exit 1

# Start the application
CMD ["pnpm", "dev"]
