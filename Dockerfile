FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 dex && adduser --system --uid 1001 dex
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/dist/ dist/
USER dex
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
