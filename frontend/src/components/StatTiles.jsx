const WORKING = ['received', 'downloading', 'processing', 'uploading', 'sending_result'];

export default function StatTiles({ stats }) {
  if (!stats) return null;
  const working = WORKING.reduce((n, k) => n + (stats.byStatus[k] || 0), 0);
  const rate = stats.successRate == null ? '—' : Math.round(stats.successRate * 100) + '%';
  const tiles = [
    [stats.total, 'Total jobs'],
    [stats.byStatus.completed || 0, 'Completed'],
    [stats.byStatus.failed || 0, 'Failed'],
    [working, 'In progress'],
    [rate, 'Success rate'],
    [stats.last24h, 'Last 24h']
  ];
  return (
    <div className="tiles">
      {tiles.map(([v, k]) => (
        <div className="tile" key={k}>
          <div className="v">{v}</div>
          <div className="k">{k}</div>
        </div>
      ))}
    </div>
  );
}
