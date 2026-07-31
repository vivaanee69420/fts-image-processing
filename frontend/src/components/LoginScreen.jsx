import { useState } from 'react';
import { login } from '../api.js';

export default function LoginScreen({ onLoggedIn }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    try {
      await login(password.trim());
      setPassword('');
      setError('');
      onLoggedIn();
    } catch (err) {
      setError(
        err.message === 'wrong password'
          ? 'Wrong password — try again.'
          : `Login failed: ${err.message}`
      );
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h2>🦷 Smile Jobs</h2>
        <p>Enter the admin password to continue.</p>
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="primary">Log in</button>
        <div className="login-error">{error}</div>
      </form>
    </div>
  );
}
