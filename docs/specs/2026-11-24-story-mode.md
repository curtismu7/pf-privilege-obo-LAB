# Story mode spec (pf-privilege-obo-LAB)

**Status:** agreed (2026-11-24) **Owner:** Curtis (decides scope)
**Process tier:** 1 (lab prototype only the owner sees).
**Contract:** `shared/story/README.md` in AI-DEMO-Standalone; how-to `shared/story/ADDING-TO-A-LAB.md`.
**Reference implementation:** `privilege-a2a-anthropic-demo-LAB` (all slices merged on its `main` as of 2026-11-24, commit `c5f237a`): the vendored engine, `web/src/storyScript.js`, `web/src/storyWiring.js`, `web/src/StoryRoot.jsx`, the `Shell.jsx` toggle, `src/story.ts` (the route), the tests, and the video bridge (`video/story_bridge.py`, `video/captions.py` reading `GET /api/story`). Copy its files; do not guess.

## Goal
Add a **Demo | Story** toggle to the lab page. **Demo** is the page exactly as it is now. **Story** walks the same numbered bubbles and slides the recorded video has, live, in **both Mock and Real**, paced by the viewer (Next/Back/Exit) with an optional Play for me (speed + Pause) that advances on the shared hold formulas. The video and Story share one wording file and one overlay, so they cannot drift.

## This lab's specifics (differs from the A2A lab)
- The page is one React app (`web/src/App.jsx`), not a server-rendered page with a vanilla island. Story still loads lazily; the toggle sits in the TopMenu's `extra` slot next to the Speed control.
- Runs: the Real page runs shapes (`agent`, `gateway`) via `POST /api/real/obo/run`; Mock runs a scenario via `POST /api/run` through `FlowSim`. The page must announce `pfo:run-start` / `pfo:run-end` (this lab's prefix, replacing the A2A lab's `paad:`) around both, and the Real run's frames render progressively (`RealObo.jsx`).
- The A2A lab's host prefix `paad:` is an A2A convention; this lab uses `pfo:` for its own events and `pfo` as the Story storage prefix.
- There are **no prompt steps**: the viewer presses Run (the lab's own button), never types a question. The script therefore has no `prompt` fields; Play for me clicks the page's Run button with an untrusted event (`el.click()`), exactly as `host.send` does elsewhere.
- Mock cannot run the Real shapes: in Mock the Real-shape steps are skipped honestly (the `modes` field), and the Mock walk shows the flow-sim steps. Mock wording uses `sample_*` variants for any bubble that claims a live call (mistake 11 in the runbook).
- The observability scene: the video shows a captured slide; the live Story shows the Run Observability panel already in the page (a Story-only bubble targeting it, skipped when there is no record). The video's captured slide stays `VIDEO_ONLY`.
- The video (`video/take.py`) moves to the shared wording and overlay in the same PR (section 9 of the runbook): `video/captions.py` reads `GET /api/story` (refusing a lab serving different bytes, via `sourceSha256`), and `video/story_bridge.py` injects the vendored `overlay.js` + `hold.js` with `follow: false`. The take's checks (`TOTAL`, bubble count, host_leaks) stay.

## Design
- Vendor `shared/story/` byte for byte into `web/src/story/` + `server/src/story/`, pin with `story.sha256` + `scripts/story-checkPin.mjs`; never edit the copies.
- `video/captions.md` stays the one wording file; the server serves it at `GET /api/story` with `sourceSha256`; a broken file is a 500 that names the wording problem and never a server path.
- `web/src/storyScript.js`: one entry per caption key, in the video's order (`take.py`'s bubble order, slides interleaved). The engine reads it through `web/src/storyWiring.js`, which is copied from the A2A lab and changed only in this lab's selectors, run events, mode plumbing and live-value readers.
- The host reports runs via `runInFlight()` / `onRun(cb)` so the bar says whose turn it is; `send` clicks the page's own Run button with `el.click()`.
- The toggle goes in `App.jsx`'s TopMenu `extra` slot; a React error boundary keeps Demo mode alive if the Story chunk fails; Exit returns to Demo, remembers it, and drops `?story=1`.

## Acceptance criteria (each a runnable check)
1. Story off: the served page is unchanged; `npm test` green; no story script requested.
2. Story on: opening slide shows the `## Header` (rule 29); Next/Back/Esc work; Esc leaves nothing in the DOM.
3. Parity test: every `# Step:` / `# Slide:` key has a matching script entry and the reverse; bubble order, counts, mode flags and fixed holds are read from `take.py`.
4. Pin test: the vendored copy matches the canonical commit byte for byte.
5. Mock: the walk shows the flow-sim steps with `sample_*` wording, says "simulated", makes no network call beyond the lab's own; Real-shape steps skip quietly.
6. Real: Part 1 (sign-in, exchange, door, tools, refusal) and Part 2 (exchange, door, whoami, actor, refusal) walk end to end; live values match the page; the bubble count equals the video's 17 for the same path.
7. Play for me reaches the same end state as Next, clicks Run with an untrusted event, stops on manual input, and at Normal speed its holds equal the video's formulas (hold test over every key).
8. No screenshot is committed; slides are text-only.
9. Browser check: `tools/walk.py` exit 0 at 1920x1080 and 1800x1169 in Mock and in Real; `tools/play.py` exit 0; screenshots read (rule 9).
10. Video rehearsal: the new `take.py` still shows 17 bubbles, `result.json` checks pass, and a `REHEARSE=1` run against the stand-in produces the same stills as before the switch (pixel compare, modulo known-random ids).

## Unhappy paths
- A Real-shape step while in Mock: skipped, counter falls, no warning.
- A run that fails or is refused: the refusal bubbles are the story (a 401 refusal is an expected frame); a run that never finishes stops Play with a message.
- Real not configured: Story still runs in Mock; Real wording not shown.
- Viewer presses Run early or resets mid-story: the story re-syncs via the run events; Reset is announced (`pfo:reset`) and the wait is told honestly.
- Esc from the speed select or the scenario dialog must not exit Story unexpectedly (test it).
- localStorage blocked: the toggle still works for the session.

## Out of scope
Editing the shared TopMenu or any vendored shared file; tenant, PingFederate or cluster changes; committing screenshots; re-recording the released videos (the rehearsal compare proves the pipeline still produces the same video).

## Protected / must not break
The Real run frames, the refusal control, the run-observability record contract, the Mock flow sim, the pin checks (`gateway-trace`, `run-observability`, `standalone-ui.css`), and the existing `npm test` suite.
