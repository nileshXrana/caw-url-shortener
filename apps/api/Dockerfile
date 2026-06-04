# ────────────────────────────────────────────────────────────
# Stage 1 – Builder
# Copy everything (including host node_modules) and compile
# ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Copy all files (including pre-installed node_modules since no internet in container)
COPY . .

# Compile TypeScript
RUN node_modules/.bin/tsc -p tsconfig.build.json

# Prune devDependencies offline to keep image small
RUN npm prune --omit=dev --offline

# ────────────────────────────────────────────────────────────
# Stage 2 – Runner (production image)
# Only compiled output + pruned node_modules land here
# ────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

# Security: create and switch to a non-root user
RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --no-create-home appuser

# Copy only what is needed to run
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Runtime environment
ENV NODE_ENV=production
ENV PORT=3000

# Drop privileges
USER appuser

EXPOSE 3000

# Container health-check (hits the /health endpoint every 30 s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
