import { shortId, type DeviceState } from '../lib/device';

interface DevicePanelProps {
  readonly state: DeviceState;
  readonly onDraft: (text: string) => void;
  readonly onSave: () => void;
  readonly onToggleOnline: () => void;
  readonly onSync: () => void;
  readonly onSyncLoseResponse: () => void;
  readonly onPull: () => void;
  readonly onResend: () => void;
  readonly onKeepServer: () => void;
  readonly onKeepMine: () => void;
  readonly onEditManually: () => void;
}

export function DevicePanel(props: DevicePanelProps) {
  const { state } = props;
  const canSync = state.online && state.queue.length > 0;

  return (
    <section className={`card device${state.online ? '' : ' is-offline'}`}>
      <header className="card-header">
        <h2>{state.name}</h2>
        <button
          type="button"
          className={`pill ${state.online ? 'pill-on' : 'pill-off'}`}
          onClick={props.onToggleOnline}
          aria-pressed={state.online}
        >
          {state.online ? 'Online' : 'Offline'}
        </button>
      </header>

      <dl className="facts">
        <div>
          <dt>Known revision</dt>
          <dd>{state.known ? `rev ${state.known.revision}` : '—'}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{state.queue.length}</dd>
        </div>
      </dl>

      <textarea
        value={state.draft}
        onChange={(event) => props.onDraft(event.target.value)}
        rows={5}
        placeholder="Type the note…"
        aria-label={`${state.name} editor`}
      />

      <div className="actions">
        <button type="button" className="primary" onClick={props.onSave}>
          Save
        </button>
        <button type="button" onClick={props.onSync} disabled={!canSync}>
          Sync
        </button>
        <button
          type="button"
          onClick={props.onSyncLoseResponse}
          disabled={!canSync}
          title="The server processes the batch, but the device never sees the response"
        >
          Sync, lose response
        </button>
        <button
          type="button"
          onClick={props.onPull}
          disabled={!state.online || state.queue.length > 0}
        >
          Pull
        </button>
        <button
          type="button"
          onClick={props.onResend}
          disabled={!state.online || state.lastBatch.length === 0}
        >
          Resend last batch
        </button>
      </div>

      {state.conflict && (
        <div className="conflict" role="alert">
          <strong>Conflict on {shortId(state.conflict.opId)}</strong>
          <div className="conflict-versions">
            <div>
              <span className="label">
                Server {state.conflict.server ? `(rev ${state.conflict.server.revision})` : '(no note)'}
              </span>
              <p className="note-text">{state.conflict.server?.text ?? '—'}</p>
            </div>
            <div>
              <span className="label">Yours (based on rev {state.conflict.proposal.baseRevision})</span>
              <p className="note-text">{state.conflict.proposal.text}</p>
            </div>
          </div>
          <div className="actions">
            <button type="button" onClick={props.onKeepServer}>
              Keep server
            </button>
            <button type="button" onClick={props.onKeepMine}>
              Keep mine
            </button>
            <button type="button" onClick={props.onEditManually}>
              Merge by hand
            </button>
          </div>
        </div>
      )}

      {state.queue.length > 0 && (
        <>
          <h3>Queue</h3>
          <ul className="queue">
            {state.queue.map((operation) => (
              <li key={operation.opId}>
                <code>{shortId(operation.opId)}</code> base {operation.baseRevision} ·{' '}
                {operation.attempts === 0 ? 'not sent' : `sent ×${operation.attempts}`} · “
                {operation.text.slice(0, 40)}”
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Log</h3>
      <ol className="log">
        {state.log.length === 0 ? <li className="muted">No activity yet.</li> : null}
        {state.log.map((line, index) => (
          <li key={`${state.log.length - index}`}>{line}</li>
        ))}
      </ol>
    </section>
  );
}
