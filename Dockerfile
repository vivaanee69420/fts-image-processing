# Railway deploys this Dockerfile from the repo root.
# One container: the Express backend, which also serves frontend/admin.html.
FROM node:22-alpine

WORKDIR /app

# Install backend deps first so Docker caches this layer between code changes
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
WORKDIR /app/backend

# Railway injects PORT; server.js falls back to 3000 locally
EXPOSE 3000

CMD ["node", "server.js"]
