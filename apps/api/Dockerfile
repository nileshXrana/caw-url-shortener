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

# Explicitly clean up large dev/peer dependencies not needed at runtime (e.g. Prisma CLI, Studio, dev tools, and TS compiler)
RUN rm -rf \
    node_modules/typescript \
    node_modules/prisma \
    node_modules/@prisma/dev \
    node_modules/@prisma/engines \
    node_modules/@prisma/studio-core \
    node_modules/@prisma/get-platform \
    node_modules/@prisma/fetch-engine \
    node_modules/@prisma/streams-local \
    node_modules/@prisma/query-plan-executor \
    node_modules/@electric-sql \
    node_modules/effect \
    node_modules/hono \
    node_modules/@hono \
    node_modules/vitest \
    node_modules/@vitest \
    node_modules/fast-check \
    node_modules/@types \
    node_modules/eslint \
    node_modules/typescript-eslint \
    node_modules/@typescript-eslint \
    node_modules/supertest \
    node_modules/tsx \
    node_modules/esbuild \
    node_modules/prettier \
    node_modules/react \
    node_modules/react-dom \
    node_modules/chart.js \
    node_modules/mysql2 \
    node_modules/remeda \
    node_modules/valibot \
    node_modules/csstype \
    node_modules/jiti \
    node_modules/@angular-devkit \
    node_modules/pure-rand \
    node_modules/@radix-ui \
    node_modules/postgres \
    node_modules/@msgpackr-extract \
    node_modules/msgpackr-extract

# Clean up other DB drivers from Prisma WASM to save space
RUN find node_modules/@prisma/client/runtime/ -type f -name "query_compiler_*_bg.*.wasm-base64.*" ! -name "*postgresql*" -delete


# ────────────────────────────────────────────────────────────
# Stage 2 – Runner (production image)
# Uses node:22-alpine to keep the base image size small
# ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Security: create and switch to a non-root user (Alpine format)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

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
