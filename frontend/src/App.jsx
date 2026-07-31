import { useCallback, useEffect, useRef, useState } from 'react';
import { setUnauthorizedHandler, getStats, getJobs, logout, NotLoggedInError } from './api.js';
import LoginScreen from './components/LoginScreen.jsx';
import StatTiles from './components/StatTiles.jsx';
import JobsTable, { FilterBar } from './components/JobsTable.jsx';
import JobDetail from './components/JobDetail.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';

export default function App() {
  const [authed, setAuthed] = useState(true); // optimistic; first 401 flips it
  const [stats, setStats] = useState(null);
  const [jobsData, setJobsData] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openJob, setOpenJob] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState('');

  // api.js calls this on any 401 so the login screen appears from anywhere
  useEffect(() => setUnauthorizedHandler(() => setAuthed(false)), []);

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([getStats(), getJobs({ status, search, page })]);
      setStats(s);
      setJobsData(j);
      setError('');
    } catch (e) {
      if (!(e instanceof NotLoggedInError)) setError('Failed to load data: ' + e.message);
    }
  }, [status, search, page]);

  // load on mount + whenever filters/page change (search debounced)
  const debounce = useRef();
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(refresh, search ? 300 : 0);
    return () => clearTimeout(debounce.current);
  }, [refresh, search]);

  // auto-refresh every 10s, paused while a panel is open or logged out
  useEffect(() => {
    const t = setInterval(() => {
      if (authed && !openJob && !settingsOpen) refresh();
    }, 10000);
    return () => clearInterval(t);
  }, [authed, openJob, settingsOpen, refresh]);

  if (!authed) {
    return <LoginScreen onLoggedIn={() => { setAuthed(true); refresh(); }} />;
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <h1>Smile Jobs</h1>
        <span>
          <button onClick={() => setSettingsOpen(true)}>⚙ Settings</button>{' '}
          <button onClick={async () => { await logout(); setAuthed(false); }}>Log out</button>
        </span>
      </div>

      {error && <div className="banner">{error}</div>}
      <StatTiles stats={stats} />
      <FilterBar
        status={status}
        search={search}
        onStatus={(v) => { setStatus(v); setPage(1); }}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        onRefresh={() => { setPage(1); refresh(); }}
      />
      <JobsTable data={jobsData} onOpen={setOpenJob} onPage={setPage} />

      {openJob && (
        <JobDetail
          job={openJob}
          onClose={() => setOpenJob(null)}
          onRetried={() => { setOpenJob(null); refresh(); }}
        />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
