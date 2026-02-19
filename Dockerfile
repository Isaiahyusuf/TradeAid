# Root Dockerfile for the Node server (monorepo root)
# Builds the Node app and runs the compiled server.

FROM node:20-alpine AS builder
WORKDIR /app

# Copy package manifests and install deps
COPY package.json package-lock.json* ./
RUN apk add --no-cache python3 build-base git && \
	npm ci --silent

# Copy rest of the repository and build
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy only the built output and production node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.cjs"]
