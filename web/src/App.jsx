import React, { useEffect, useState } from "react";
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
import { useApi, postJson } from "./api.js";
import { getDiagram } from "./diagram-data.js";
import PrivilegeCheck from "./privilege-check/PrivilegeCheck.jsx";

const STUDIO = getDiagram();

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

  const switchMode = async (target) => {
    const r = await postJson("/api/mode", { source: target });
    if (r.status === 200) {
      setSource(r.body.source);
      // Rule 19: the toggle reloads all data after switching.
      const c = await fetch("/api/catalog").then((x) => x.json()).catch(() => null);
      if (c) catalog.data = c;
    }
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
        <OpeningCard opening={data && data.opening} />
        {presenter && (
          <aside className="presenter-say" data-testid="presenter-say" aria-label="Talk track">
            {presenterSay(activeScenario) || "Pick a scenario and press Simulate."}
          </aside>
        )}
        {source === "real" ? (
          <RealObo />
        ) : (
          <>
            <ScenarioPicker scenarios={(data && data.scenarios) || []} active={activeScenario} onSelect={setActiveScenario} />
            <FlowSim catalog={data} activeScenario={activeScenario} speed={speed} />
          </>
        )}
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
