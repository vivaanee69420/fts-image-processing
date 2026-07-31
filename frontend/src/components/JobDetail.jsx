import { useState } from 'react';
import StatusBadge from './StatusBadge.jsx';
import { retryJob } from '../api.js';

function Photo({ label, url }) {
  const [broken, setBroken] = useState(false);
  return (
    <figure>
      <figcaption>{label}</figcaption>
      {!url ? (
        <div className="img-missing">no image yet</div>
      ) : broken ? (
        <div className="img-missing">
          image failed to load<br />
          <a href={url} target="_blank" rel="noreferrer">open URL</a>
        </div>
      ) : (
        <img src={url} alt={label} onError={() => setBroken(true)} />
      )}
    </figure>
  );
}

export default function JobDetail({ job, onClose, onRetried }) {
  const [msg, setMsg] = useState('');

  async function retry() {
    try {
      await retryJob(job._id);
      setMsg('Retry started — refreshing…');
      setTimeout(onRetried, 1200);
    } catch (e) {
      setMsg('Retry failed: ' + e.message);
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="panel">
        <div className="row">
          <h2>{job.name || 'Unnamed'} <StatusBadge status={job.status} /></h2>
          <button onClick={onClose}>Close ✕</button>
        </div>
        <dl>
          <dt>Job ID</dt><dd>{job._id}</dd>
          <dt>Contact ID</dt><dd>{job.ghlContactId}</dd>
          <dt>Phone</dt><dd>{job.phone}</dd>
          <dt>Email</dt><dd>{job.email || '—'}</dd>
          <dt>Attempts</dt><dd>{job.attempts}</dd>
          <dt>Created</dt><dd>{new Date(job.createdAt).toLocaleString()}</dd>
          <dt>Last attempt</dt><dd>{job.lastAttemptAt ? new Date(job.lastAttemptAt).toLocaleString() : '—'}</dd>
          <dt>Failure reason</dt><dd>{job.failureReason || '—'}</dd>
        </dl>
        <div className="imgs">
          <Photo label="Original" url={job.originalImageUrl} />
          <Photo label="Processed" url={job.processedImageUrl} />
        </div>
        {job.status === 'failed' && (
          <p><button className="primary" onClick={retry}>Retry this job</button></p>
        )}
        <p className="auto-note">{msg}</p>
      </aside>
    </>
  );
}
