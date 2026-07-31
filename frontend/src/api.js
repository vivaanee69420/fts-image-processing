// Thin fetch wrapper. All paths are same-origin (dev: vite proxy,
// prod: nginx proxy), so cookies flow automatically and CORS never applies.

let onUnauthorized = () => {};

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export class NotLoggedInError extends Error {
  constructor() {
    super('not logged in');
    this.name = 'NotLoggedInError';
  }
}

export async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    onUnauthorized();
    throw new NotLoggedInError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${path} → HTTP ${res.status}`);
  }
  return res.json();
}

export const postJson = (path, body, method = 'POST') =>
  api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

export const login = (password) => postJson('/api/login', { password });
export const logout = () => fetch('/api/logout', { method: 'POST' }).catch(() => {});
export const getStats = () => api('/api/stats');
export const getJobs = ({ status, search, page }) => {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (search) q.set('search', search);
  q.set('page', page);
  return api('/api/jobs?' + q);
};
export const retryJob = (id) => postJson(`/api/jobs/${id}/retry`, {});
export const getSettings = () => api('/api/settings');
export const saveSettings = (settings) => postJson('/api/settings', settings, 'PUT');
