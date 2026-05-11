# --- Build Stage ---
FROM node:20 AS builder

WORKDIR /app

# Copy manifest files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies
RUN npm ci

# Debug: check contents
RUN cat package.json
RUN ls -la node_modules/.bin || echo "bin not found"
RUN ls -la node_modules/.bin/prisma || echo "prisma not found"

# Copy source code
COPY . .

# Build the application (runs prebuild: prisma generate)
RUN npm run build

# --- Production Stage ---
FROM node:20 AS runner

WORKDIR /app

# Copy production dependencies from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose the configured port
EXPOSE 3000

# Start command
CMD ["node", "dist/main.js"]
