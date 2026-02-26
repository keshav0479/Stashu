# ---- Stage 1: Build ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/ shared/

# HUSKY=0 disables the prepare hook; native addons still compile normally
ENV HUSKY=0
RUN npm ci

# Copy source files
COPY client/ client/
COPY server/ server/

# Build client (Vite) and server (tsc)
RUN npm run build

# ---- Stage 2: Production Runtime ----
FROM node:22-alpine AS runtime

# Install build tools for native modules (better-sqlite3 needs node-gyp)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files for production install
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/ shared/

# Install with --ignore-scripts (skips husky + native builds),
# then rebuild native modules explicitly
RUN npm ci --workspace=server --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3

# Remove build tools after install to keep image small
RUN apk del python3 make g++

# Copy built artifacts from builder
COPY --from=builder /app/client/dist client/dist
COPY --from=builder /app/server/dist server/dist

# Create data directory for SQLite
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV DB_PATH=/data/stashu.db
ENV PORT=3000

EXPOSE 3000

USER node

CMD ["node", "server/dist/server/src/index.js"]
