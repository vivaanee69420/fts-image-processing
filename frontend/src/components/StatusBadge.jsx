const ICONS = { completed: '✓', failed: '✕' };

export default function StatusBadge({ status }) {
  const cls = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'working';
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" />
      {ICONS[status] || '●'} {status}
    </span>
  );
}
