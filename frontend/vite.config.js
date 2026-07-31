import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset paths relative so the same build works both
// served at '/' (nginx frontend service) and under '/admin' (backend
// serving the built dist during local single-server dev).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // Local dev: `npm run dev` here + backend on :3000 — same-origin via proxy,
    // exactly like nginx does in production. No CORS anywhere.
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
      '/jobs': 'http://localhost:3000',
      '/health': 'http://localhost:3000'
    }
  }
});
