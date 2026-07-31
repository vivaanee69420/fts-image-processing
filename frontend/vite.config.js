import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset paths relative so the same build works both
// served at '/' (nginx frontend service) and under '/admin' (backend
// serving the built dist during local single-server dev).
// Dev-only proxy target; override with DEV_BACKEND_URL if the backend
// runs elsewhere. Production uses nginx + BACKEND_URL instead (no CORS).
const backend = process.env.DEV_BACKEND_URL || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': backend,
      '/webhooks': backend,
      '/jobs': backend,
      '/health': backend
    }
  }
});
