# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# The browser bundle and the API server, from the same sources — the server
# reuses the client's op model so both sides apply edits identically.
RUN npm run build && npm run build:server

# --- runtime stage ---
# One process serves both the static app and the API, so there is no nginx and
# no second container to keep in step.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist
# Marks the compiled server as CommonJS (the root package is an ES module).
COPY server/package.json ./server/package.json

ENV DATA_DIR=/data
ENV STATIC_DIR=/app/dist
ENV PORT=80
VOLUME /data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/api/me >/dev/null 2>&1 || exit 1
CMD ["node", "server/dist/server/src/index.js"]
