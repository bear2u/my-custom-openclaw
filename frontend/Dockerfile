# Frontend build Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Output stage - just copy the built files
FROM alpine:latest

WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# The dist folder will be mounted as volume
CMD ["echo", "Frontend build complete. Files in /app/dist"]
