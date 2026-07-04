# ════════════════════════════════════════════════════════════════════
# Frontend — Build stage
# ════════════════════════════════════════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

# Aceita a URL do backend em build-time (CRA injeta no bundle)
ARG REACT_APP_BACKEND_URL
ARG REACT_APP_HOURS_CLOSE_TICKETS_AUTO=24
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL
ENV REACT_APP_HOURS_CLOSE_TICKETS_AUTO=$REACT_APP_HOURS_CLOSE_TICKETS_AUTO
ENV NODE_OPTIONS=--openssl-legacy-provider
ENV GENERATE_SOURCEMAP=false

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build


# ════════════════════════════════════════════════════════════════════
# Frontend — Runtime stage (Nginx servindo o build estático)
# ════════════════════════════════════════════════════════════════════
FROM nginx:alpine

# Config para SPA: fallback de rotas para index.html
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    # Cache agressivo para assets versionados \
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2)$ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
