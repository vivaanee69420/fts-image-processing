# Frontend service — Railway root directory: frontend/
# Stage 1 builds the React app; stage 2 serves it with nginx, which also
# proxies API/webhook calls to the backend service so the browser sees one
# origin (no CORS, cookies just work).
#
# Required Railway variable on THIS service:
#   BACKEND_URL = the backend service's public URL, e.g.
#                 https://your-backend-production.up.railway.app  (no trailing slash)
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine substitutes ${VARS} in /etc/nginx/templates/*.template at startup
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Railway injects PORT; default for local docker runs
ENV PORT=8080
EXPOSE 8080
