FROM node:20-slim

# Install minimal dependencies (no Chromium needed — using PDFKit for PDF generation)
RUN apt-get update && apt-get install -y \
    openssl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production=false

# Generate Prisma client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code and build
COPY . .
RUN npm run build

# Copy non-TypeScript assets to dist
RUN cp -r src/templates dist/templates 2>/dev/null || true

# Clean up devDependencies
RUN npm prune --production

EXPOSE 4000

# Run migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
