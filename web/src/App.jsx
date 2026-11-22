import React, { useEffect, useRef, useState } from "react";
import TopMenu from "./top-menu/TopMenu.jsx";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import VerifyMark from "./components/VerifyMark.jsx";
import "./top-menu/top-menu.css";
import SimulationBanner, { ModeToggle } from "./Banner.jsx";
import ThemePicker from "./ThemePicker.jsx";
import FlowSim from "./FlowSim.jsx";
import ScenarioPicker from "./ScenarioPicker.jsx";
import RealObo from "./RealObo.jsx";
import IssuesPanel from "./IssuesPanel.jsx";
import ChainSteps from "./ChainSteps.jsx";
import OpeningCard from "./OpeningCard.jsx";
import { useApi, postJson, getRunObservability } from "./api.js";
import RunObservability from "./run-observability/RunObservability.jsx";
import RunObsLoading from "./RunObsLoading.jsx";
import { getDiagram } from "./diagram-data.js";
import PrivilegeCheck from "./privilege-check/PrivilegeCheck.jsx";

const STUDIO = getDiagram();

// Where this lab's run leaves logs and where they stream (rule 27); the README says the same.
const RUN_STREAMS = [
  { product: "This lab (server)", lives: "its container stdout: one [time] INFO line per decision, with the actor and the result, never a token", streams: "the collector to demo-logs-<service> when one is set up, then a SIEM; Mock rows are never read from it" },
  { product: "PingFederate (sign-in, token exchange)", lives: "container stdout; the audit log is not shipped today, so the person's sign-in is not logged", streams: "the collector to ping-logs-pingfederate once the audit log is shipped" },
  { product: "Privilege agent gateway (the doors)", lives: "local: cyonproxy.log in its log volume; hosted: the SIEM index ping-siem-events-v2 and the console Activity Logs", streams: "the collector to ping-logs-privilege-gateway; the Privilege SIEM export" },
  { product: "Backend MCP server", lives: "Mock: in-process stub with no log; Real: the MCP server container stdout", streams: "the collector to demo-logs-<service>" },
];
const REREAD_MS = 5000;

// Presenter mode (rule 3): hides the intro copy and shows the talk-track line
// for the current step while presenting.
const talkSteps = (STUDIO.steps || []).map((st, i) => ({ id: `step-${i + 1}`, title: st.title, say: st.what }));
function presenterSay(activeScenario) {
  const steps = STUDIO.steps || [];
  if (!activeScenario) return steps.length ? `Start: ${steps[0].title}. ${steps[0].what}` : null;
  const byScenario = {
    "happy-read": 1,
    "happy-admin": 1,
    "cedar-block": 5,
    "cedar-actsub": 5,
    "act-text": 3,
    "wrong-audience": 3,
    "no-grant": 4,
    garbage: 3,
    autonomous: 3
  };
  const step = steps[(byScenario[activeScenario.id] || 1) - 1];
  return step ? `${step.title}. ${step.what} ${step.why || ""}` : null;
}

export default function App() {
  const catalog = useApi("/api/catalog");
  const info = useApi("/api/info");
  const [source, setSource] = useState("mock");
  const [activeScenario, setActiveScenario] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "auto");
  useEffect(() => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch { /* none */ }
  }, [theme]);
  const [presenter, setPresenter] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [obs, setObs] = useState({ key: null, record: null }); // the record read for `key`: { record: null = no such run | the record | { error, message } }
  const [obsTarget, setObsTarget] = useState(undefined); // the run to read: its id, undefined = the newest run of this mode, null = an attempt that began no run
  const [obsTick, setObsTick] = useState(0); // bumped after each run, and by the Re-read button
  const [ranIn, setRanIn] = useState(null); // { n, source } of the latest run: the delayed re-read belongs to a Real run only
  const [obsBusy, setObsBusy] = useState(false);
  const [modeError, setModeError] = useState(null); // the server's reason when it refuses a mode switch (a Real run in flight)
  const [obsReadAt, setObsReadAt] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && presenter) setPresenter(false);
      if (e.key.toLowerCase() === "p" && e.altKey) setPresenter((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenter]);

  useEffect(() => {
    if (info.data) setSource(info.data.source);
  }, [info.data]);

  // Rule 27: read the record of the run just made after every run, every Mock/Real switch and on demand. The record belongs to the key it was read
  // for (mode and run): another run, or the other mode, never shows it, it shows "collecting" until its own record is read.
  const obsKey = `${source}|${obsTarget === undefined ? "newest" : obsTarget}`;
  const rereadFresh = useRef(false); // set by the Re-read button and the delayed re-read: the next read rebuilds the record instead of using the kept one
  const rereadNow = () => { rereadFresh.current = true; setObsTick((n) => n + 1); };
  useEffect(() => {
    if (obsTarget === null) return undefined; // the attempt began no run: nothing to read, and the older run's record is not its record
    let live = true;
    setObsBusy(true);
    const fresh = rereadFresh.current;
    rereadFresh.current = false;
    getRunObservability(obsTarget, { fresh })
      .then((record) => { if (live) { setObs({ key: obsKey, record }); setObsReadAt(new Date()); } })
      .catch(() => live && setObs({ key: obsKey, record: { error: "unreachable", message: "The run record could not be loaded." } }))
      .finally(() => live && setObsBusy(false));
    return () => { live = false; };
  }, [obsKey, obsTick]);

  // Real only: a collector ships lines with a delay, so the run just made reads "not logged" at first. Read once more about 5 s after it.
  useEffect(() => {
    if (source !== "real" || ranIn?.source !== "real") return undefined;
    const t = setTimeout(rereadNow, REREAD_MS);
    return () => clearTimeout(t);
  }, [ranIn, source]);

  // A run finished: read ITS record (id). null = an attempt that began no run (a failed start): show the empty state, not the older run's record.
  const ran = (id) => {
    setObsTarget(id === null ? null : id || undefined);
    if (id !== null) setRanIn((r) => ({ n: (r?.n ?? 0) + 1, source }));
    setObsTick((n) => n + 1);
  };

  const switchMode = async (target) => {
    const r = await postJson("/api/mode", { source: target });
    if (r.status === 200) {
      setSource(r.body.source);
      setModeError(null);
      setObsTarget(undefined); // a run id belongs to one mode: after a switch read the newest run of the new mode
      // Rule 19: the toggle reloads all data after switching.
      const c = await fetch("/api/catalog").then((x) => x.json()).catch(() => null);
      if (c) catalog.data = c;
    } else if (r.status === 409 && r.body?.error === "run_in_progress") setModeError(r.body.message);
  };

  const data = catalog.data;
  return (
    <div className="app">
      <header className="shell-bar">
        <div className="shell-brand">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          PF → Privilege OBO Lab
        </div>
        <nav className="shell-nav" aria-label="Sections">
          <a href="#flow" aria-current="page">
            Flow
          </a>
          <a href="#steps">Steps</a>
          <a href="#issues">Issues</a>
        </nav>
        <div className="shell-right">
          <TopMenu
            mode={{ value: source === "real" ? "real" : "mock", onChange: (m) => switchMode(m === "real" ? "real" : "mock"), realAvailable: info.data ? info.data.realAvailable !== false : null, realHint: info.data?.realReason || undefined }}
            theme={{ value: theme, onChange: setTheme }}
            present={{ active: presenter, onToggle: () => setPresenter((v) => !v), label: "Presenter (Alt+P)" }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
            extra={<label className="speed-control" htmlFor="speed">Speed
              <select id="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </label>}
          >
            <VerifyMark id="pf-privilege-obo-lab" />
          </TopMenu>
        </div>
      </header>
      <div className="accent-rule" aria-hidden="true" />
      <main>

        {source !== "real" && <PrivilegeCheck />}
        <SimulationBanner source={source} />
        {modeError && <p className="run-result refused" role="alert" data-testid="mode-error">{modeError}</p>}
        <OpeningCard opening={data && data.opening} />
        {presenter && (
          <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
            {presenterSay(activeScenario) || "Pick a scenario and press Simulate."}
          </aside>
        )}
        {source === "real" ? (
          <RealObo onRan={ran} />
        ) : (
          <>
            <ScenarioPicker scenarios={(data && data.scenarios) || []} active={activeScenario} onSelect={setActiveScenario} />
            <FlowSim catalog={data} activeScenario={activeScenario} speed={speed} onScenarioDone={(r) => ran(r?.id)} />
          </>
        )}
        <div className="run-obs-slot">
          {source === "real" && (
            <div className="run-obs-tools">
              <button type="button" className="run-obs-reread" data-testid="ro-reread" disabled={obsBusy} onClick={rereadNow}>Re-read logs</button>
              <span className="run-obs-note" data-testid="ro-read-note">
                {obsReadAt ? `Read at ${obsReadAt.toLocaleTimeString()}. ` : ""}A collector ships lines with a delay: the run just made may read "not logged" until it has. The page reads again about 5 seconds after each run. "Not found (partial search)" means the search was cut, so absence is not proof.
              </span>
            </div>
          )}
          {/* After a Mock/Real switch the old mode's record stays in `obs` until the new read returns: it is not shown under the new label. */}
          {obsTarget !== null && obs.key !== obsKey
            ? <RunObsLoading />
            : <RunObservability record={obsTarget === null ? null : obs.record?.rows && obs.record.source !== (source === "real" ? "real" : "mock") ? null : obs.record} source={source === "real" ? "real" : "mock"} streams={RUN_STREAMS} />}
        </div>
        <ChainSteps steps={(data && data.steps) || []} />
        <IssuesPanel issues={(data && data.issues) || []} does={(data && data.does) || []} cant={(data && data.cant) || []} />
      </main>
      <footer className="app-footer">
        {source === "real"
          ? "Demo tier · Real mode: live calls to your own tenant · demo tokens shown in full, secrets never"
          : "Demo tier · everything simulated · mock tokens labelled · raw token bodies stay server-side"}
      </footer>

      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={talkSteps} />
    </div>
  );
}
