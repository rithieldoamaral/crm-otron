# ════════════════════════════════════════════════════════════════════
# Backend — Build stage
# ════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

# Dependências de build (sharp, sqlite3, etc.)
RUN apk add --no-cache python3 make g++ git

# Copia manifestos primeiro para aproveitar cache do Docker
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copia o restante e compila TypeScript
COPY . .
RUN npm run build


# ════════════════════════════════════════════════════════════════════
# Backend — Runtime stage (imagem final, leve)
# ════════════════════════════════════════════════════════════════════
FROM node:20-alpine

WORKDIR /app

# Dependências mínimas para runtime do Baileys + sharp
RUN apk add --no-cache ffmpeg chromium

# Variáveis necessárias para o chromium do Baileys
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Volume para sessões do WhatsApp e uploads
RUN mkdir -p /app/public/uploads /app/sessions

EXPOSE 8080

CMD ["node", "--max-old-space-size=4096", "dist/server.js"]
