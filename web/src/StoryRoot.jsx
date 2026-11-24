import React, { useEffect, useRef, useState } from "react";
import { createOverlay } from "./story/overlay.js";
import { createStory } from "./story/engine.js";
import StoryBar from "./story/StoryBar.jsx";
import { createHost, buildSteps } from "./storyWiring.js";

// Story mode, loaded only when the viewer turns Story on (App.jsx lazy-loads this file, so Demo mode never pays for it). It fetches the wording, builds the
// engine from the script and the page host, starts the walk-through, and tears everything down when it is switched off. Changing Mock/Real mid-story restarts
// the story (the steps and the wording differ between the two).

const storage = () => { try { return window.localStorage; } catch { return null; } };

export default function StoryRoot({ mode, ready = true, onExit, prefix = "pfo" }) {
  const [story, setStory] = useState(null);
  const [error, setError] = useState("");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    let live = true;
    let parts = null;
    document.documentElement.classList.add("story-on");
    fetch("/api/story", { headers: { Accept: "application/json" } })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        return body;
      })
      .then((captions) => {
        if (!live) return;
        const host = createHost({ mode: () => modeRef.current });
        const overlay = createOverlay();
        const s = createStory({ steps: buildSteps({ captions, host }), captions, overlay, host, store: storage(), prefix });
        let wasActive = false;
        s.subscribe((st) => { if (wasActive && !st.active && live) onExit(); wasActive = st.active; });
        parts = { host, overlay, s };
        setStory(s);
      })
      .catch((e) => { if (live) setError(e.message || "The Story wording could not be loaded."); });
    return () => {
      live = false;
      document.documentElement.classList.remove("story-on");
      if (parts) {   // exit first: it closes an open pop-out and clears the overlay; then everything is released
        const { s, host, overlay } = parts;
        s.exit().finally(() => { s.destroy(); host.dispose(); overlay.destroy(); });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one story per time Story is switched on

  // Start once the wording is loaded AND the server's mode is known (a Real lab must not flash the Mock walk-through). After that, a Mock/Real switch restarts
  // the walk-through (the steps and the wording differ between the two).
  const started = useRef(false);
  useEffect(() => {
    if (!story || !ready) return;
    if (!started.current) { started.current = true; story.start(); return; }
    window.dispatchEvent(new CustomEvent("pfo:reset"));
    story.restart();
  }, [story, ready, mode]);

  if (error) {
    return (
      <div className="story-bar" role="alert" data-testid="story-error">
        <span className="story-msg">Story could not start: {error}</span>
        <button type="button" onClick={onExit}>Exit</button>
      </div>
    );
  }
  return story ? <StoryBar story={story} mock={mode === "mock"} /> : null;
}
