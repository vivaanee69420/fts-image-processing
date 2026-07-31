# Frontend service — Railway root directory: frontend/
# nginx serves the dashboard and proxies API/webhook calls to the backend
# service, so the browser sees one origin (no CORS, cookies just work).
#
# Required Railway variable on THIS service:
#   BACKEND_URL = the backend service's public URL, e.g.
#                 https://your-backend-production.up.railway.app  (no trailing slash)
FROM nginx:alpine

COPY admin.html /usr/share/nginx/html/index.html

# nginx:alpine substitutes ${VARS} in /etc/nginx/templates/*.template at startup
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Railway injects PORT; default for local docker runs
ENV PORT=8080
EXPOSE 8080
