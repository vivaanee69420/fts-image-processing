import StatusBadge from './StatusBadge.jsx';

const STATUSES = ['received', 'downloading', 'processing', 'uploading', 'sending_result', 'completed', 'failed'];

export function FilterBar({ status, search, onStatus, onSearch, onRefresh }) {
  return (
    <div className="bar">
      <select value={status} onChange={(e) => onStatus(e.target.value)}>
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <input
        type="search"
        placeholder="Search name / phone / email"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <button className="primary" onClick={onRefresh}>Refresh</button>
      <span className="auto-note">auto-refreshes every 10s</span>
    </div>
  );
}

export default function JobsTable({ data, onOpen, onPage }) {
  if (!data) return null;
  return (
    <>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Created</th><th>Name</th><th>Phone</th><th>Status</th>
              <th className="num">Attempts</th><th>Failure reason</th>
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((j) => (
              <tr key={j._id} onClick={() => onOpen(j)}>
                <td>{new Date(j.createdAt).toLocaleString()}</td>
                <td>{j.name || '—'}</td>
                <td>{j.phone}</td>
                <td><StatusBadge status={j.status} /></td>
                <td className="num">{j.attempts}</td>
                <td className="reason" title={j.failureReason || ''}>{j.failureReason || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>‹ Prev</button>
        <span>page {data.page} / {data.pages} — {data.total} jobs</span>
        <button disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)}>Next ›</button>
      </div>
    </>
  );
}
