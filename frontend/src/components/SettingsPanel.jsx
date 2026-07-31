import { useEffect, useState } from 'react';
import { getSettings, saveSettings } from '../api.js';

function ConfigItem({ ok, label, hint }) {
  return (
    <li className={ok ? 'ok' : 'miss'}>
      {ok ? '✓' : '✕'} {label}
      {!ok && <span className="why"> — {hint}</span>}
    </li>
  );
}

export default function SettingsPanel({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [resultsUrl, setResultsUrl] = useState('');
  const [saveMsg, setSaveMsg] = useState(null); // { ok, text }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        setResultsUrl(s.resultsWebhookUrl);
      })
      .catch((e) => setError(e.message));
  }, []);

  const receiveUrl = settings ? window.location.origin + settings.inboundWebhookPath : '';

  async function copyReceive() {
    try {
      await navigator.clipboard.writeText(receiveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard blocked — copy the URL manually.');
    }
  }

  async function save() {
    try {
      await saveSettings({ resultsWebhookUrl: resultsUrl.trim() });
      setSaveMsg({ ok: true, text: 'Saved ✓ — takes effect immediately, no restart needed.' });
    } catch (e) {
      setSaveMsg({ ok: false, text: 'Save failed: ' + e.message });
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="panel">
        <div className="row">
          <h2>⚙ Settings</h2>
          <button onClick={onClose}>Close ✕</button>
        </div>

        {error && <p className="set-msg-err">{error}</p>}
        {!settings && !error && <p className="auto-note">Loading settings…</p>}

        {settings && (
          <>
            <div className="set-block">
              <label>RECEIVE — your webhook URL (paste into the GHL form workflow's Webhook action)</label>
              <div className="set-row">
                <input type="text" readOnly value={receiveUrl} />
                <button onClick={copyReceive}>{copied ? 'Copied ✓' : 'Copy'}</button>
              </div>
              <div className="set-hint">
                ⚠ GHL cannot reach <b>localhost</b>. Open this dashboard on your deployed domain
                and this box shows the correct public URL automatically.
              </div>
            </div>

            <div className="set-block">
              <label>SEND — GHL Inbound Webhook trigger URL (processed image + contact details are POSTed here)</label>
              <div className="set-row">
                <input
                  type="url"
                  placeholder="https://services.leadconnectorhq.com/hooks/…"
                  value={resultsUrl}
                  onChange={(e) => setResultsUrl(e.target.value)}
                />
                <button className="primary" onClick={save}>Save</button>
              </div>
              <div className="set-hint">
                In GHL: create a workflow with an <b>Inbound Webhook</b> trigger and copy its URL here.
                Fields sent: jobId, contactId, name, email, phone, originalImageUrl, processedImageUrl.
              </div>
              {saveMsg && (
                <div className={`set-hint ${saveMsg.ok ? 'set-msg-ok' : 'set-msg-err'}`}>{saveMsg.text}</div>
              )}
            </div>

            <div className="set-block">
              <label>CONFIG STATUS</label>
              <ul className="cfg">
                <ConfigItem ok={settings.config.mongodb} label="MongoDB connected" hint="check MONGODB_URI in .env" />
                <ConfigItem ok={settings.config.gemini} label="Gemini API key (AI image editing)" hint="set GEMINI_API_KEY in .env" />
                <ConfigItem ok={settings.config.s3} label="S3 storage (processed images)" hint="set AWS keys + S3_BUCKET_NAME + S3_PUBLIC_BASE_URL in .env" />
                <ConfigItem ok={settings.config.resultsWebhook} label="Results webhook URL (send)" hint="fill the SEND field above" />
              </ul>
              <div className="set-hint">
                Items marked ✕ make jobs fail at that pipeline step. .env changes need a server restart.
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
