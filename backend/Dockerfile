# Backend service — Railway root directory: backend/
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

# Railway injects PORT; server.js falls back to 3000 locally
EXPOSE 3000

CMD ["node", "server.js"]
