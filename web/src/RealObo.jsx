import React, { useState } from "react";
import FloatingDialog from "./floating-dialog/FloatingDialog";
import Json from "./components/JsonPane.jsx";
import { useApi, postJson } from "./api.js";

// Real mode (rule 19): one live on-behalf-of run, shown as numbered frames. Every frame opens a pop-out with what was
// sent, what came back, the decoded token (claims only: the token itself never reaches this page) and the spec notes.

const SHAPES = [
  { id: "agent", label: "Agent-side (Pass Agent Token)", blurb: "The agent trades the person's ID token for an access token and calls the door. Privilege checks the token." },
  { id: "gateway", label: "Gateway OBO (Auth Mode OBO)", blurb: "The same exchange, then the gateway makes a second one for the backend, and the backend reports what it saw." },
];
const PILL = { ok: "pill yes", refused: "pill partial", error: "pill no", skipped: "pill" };
const STATE_WORD = { ok: "ok", refused: "refused", error: "failed", skipped: "skipped" };

function FrameDetail({ frame }) {
  const claims = frame.token?.claims;
  return (
    <div data-testid="frame-detail">
      <p>{frame.summary}</p>
      {frame.request && (
        <section>
          <h3>Sent</h3>
          <p className="mono">{frame.request.method} {frame.request.url}</p>
          <table className="real-params">
            <tbody>
              {frame.request.params.map((p) => (
                <tr key={p.name}><th scope="row">{p.name}</th><td className="mono">{p.value}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {frame.response && (
        <section>
          <h3>Came back</h3>
          <Json value={frame.response} label="Response" testId="frame-response" decode={false} />
        </section>
      )}
      {frame.token && (
        <section>
          <h3>Decoded {frame.token.kind}</h3>
          <p className="hint">
            A real token from your tenant, shown in full because this is a demo. {frame.token.length} characters, sha256/8 {frame.token.hash}
            {frame.token.lifetimeSec != null ? `, valid ${frame.token.lifetimeSec} s` : ""}. Client secrets and the password are never shown.
          </p>
          <pre className="mono real-token" tabIndex={0} aria-label={`${frame.token.kind} (encoded)`} data-testid="frame-token">{frame.token.raw}</pre>
          <Json value={claims} label="Claims" testId="frame-claims" decode={false} hot={["sub", "act", "aud"]} />
        </section>
      )}
      {frame.backend && (
        <section>
          <h3>What the backend reported</h3>
          <Json value={frame.backend} label="Backend" testId="frame-backend" decode={false} hot={["subject", "actor", "audience"]} />
        </section>
      )}
      {frame.inferred && <p className="hint" data-testid="frame-inferred"><strong>Inferred, not reported:</strong> {frame.inferred}</p>}
      {frame.spec?.length > 0 && (
        <section>
          <h3>What the specs say</h3>
          <ul className="real-spec">
            {frame.spec.map((s) => <li key={s.ref}><strong>{s.ref}</strong>: {s.note}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function RealObo() {
  const view = useApi("/api/real/obo");
  const [shape, setShape] = useState("agent");
  const [refusal, setRefusal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const cfg = view.data;
  const available = (id) => Boolean(cfg?.shapes?.[id]);

  const start = async () => {
    setBusy(true); setError(null); setOpen(null);
    const r = await postJson("/api/real/obo/run", { shape, refusal });
    setBusy(false);
    if (r.status === 200) setRun(r.body);
    else { setRun(null); setError(r.body?.error || `HTTP ${r.status}`); }
  };

  const frame = run?.frames?.find((f) => f.n === open) || null;
  return (
    <section className="card" data-testid="real-obo" aria-labelledby="real-obo-h">
      <h2 id="real-obo-h">Real on-behalf-of run</h2>
      <p className="hint">
        Live calls: the person signs in, the agent exchanges, and Privilege's door answers. Each step is a numbered frame; open one to see what was sent and what came back.
        {cfg?.configured ? ` Signing in as ${cfg.user}.` : ""}
      </p>
      {cfg && !cfg.configured && <p className="hint" data-testid="real-obo-unconfigured">{cfg.reason}</p>}
      <div className="flow-controls" role="group" aria-label="Which shape">
        {SHAPES.map((s) => (
          <button key={s.id} type="button" className={shape === s.id ? "scenario-btn pressed" : "scenario-btn"} aria-pressed={shape === s.id} disabled={!available(s.id)}
            title={available(s.id) ? s.blurb : "Not configured in this lab's .env"} onClick={() => setShape(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="hint">{SHAPES.find((s) => s.id === shape).blurb}</p>
      <div className="flow-controls">
        <label><input type="checkbox" checked={refusal} onChange={(e) => setRefusal(e.target.checked)} /> Also try a refused call (a made-up token)</label>
        <button type="button" className="real-run" disabled={busy || !available(shape)} onClick={start} data-testid="real-obo-run">
          {busy ? "Running…" : "Run live"}
        </button>
      </div>
      {error && <p className="run-result refused" role="alert" data-testid="real-obo-error">{error}</p>}
      {run && (
        <div data-testid="real-obo-frames">
          <p className="hint">Run {run.ok ? "completed" : "stopped early"} in {run.ms} ms.</p>
          <ol className="real-frames">
            {run.frames.map((f) => (
              <li key={f.n}>
                <button type="button" className="real-frame" onClick={() => setOpen(f.n)} data-testid={`frame-${f.n}`} aria-label={`Frame ${f.n}: ${f.title}`}>
                  <span className="real-frame__n">{f.n}</span>
                  <span className="real-frame__body">
                    <strong>{f.title}</strong>
                    <span>{f.summary}</span>
                  </span>
                  <span className={PILL[f.state] || "pill"}>{STATE_WORD[f.state] || f.state}</span>
                  {f.ms != null && <span className="hint">{f.ms} ms</span>}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      <FloatingDialog isOpen={Boolean(frame)} onClose={() => setOpen(null)} title={frame ? `Frame ${frame.n}: ${frame.title}` : "Frame"} ariaLabel="Frame detail"
        defaultWidth={520} defaultHeight={null} placement="right" storageKey="real-obo-frame" singletonKey="real-obo-frame" testId="frame-dialog">
        {frame && <FrameDetail frame={frame} />}
      </FloatingDialog>
    </section>
  );
}
