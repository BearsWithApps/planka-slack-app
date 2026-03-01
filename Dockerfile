FROM node:20-alpine AS deps
WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER appuser

# Default to HTTP mode on port 3000; override with SLACK_APP_TOKEN for socket mode
EXPOSE 3000

CMD ["node", "src/index.js"]
