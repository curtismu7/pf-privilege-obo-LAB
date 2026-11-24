// The Story script: one entry per caption key, in the order the recorded video walks the lab (video/take.py). Pure data, no DOM: the page wiring turns each
// entry into an engine step (a selector, a pop-out, a live line). The wording is in video/captions.md; test/story.test.js checks the two agree, and that the
// order, the numbered-bubble counts and the fixed holds equal take.py's.
//
//   target   a CSS selector (a frame pop-out step uses `popout` instead)
//   popout   { frame, section }: open that numbered frame's detail pop-out and point the bubble at the section whose h3 starts with `section`
//            (the whole pop-out when there is no such section). The wiring opens it in `before()` and closes it in `after()`.
//   lines    the name of a live value the page reads for the bubble's fact lines (the page wiring)
//   trigger  'load' | 'run-done' | 'frame' (a Real run's numbered frames appearing)
//   modes    ['real'] or ['mock']: shown only there. sampleKey: the Mock wording key (a bubble that claims a live call needs one).
//   fixedSecs only where take.py passes secs=; Play for me holds every other bubble for its wording (shared hold.js, the video's own formulas).

const RUN_BTN = '[data-testid=real-obo-run]';
const SHAPES_GROUP = "[aria-label='Which shape']";
const OBS_PANEL = '.run-obs-slot';
const MOCK_PANEL = '[data-testid=flow-sim]';

export const STEPS = [
  { key: 'sample_note', type: 'slide', trigger: 'load', modes: ['mock'] },   // the simulated run says so first
  { key: 'opening', type: 'slide', trigger: 'load' },

  // ---- the RFC slide the video shows before Part 1
  { key: 'rfc8693', type: 'slide', trigger: 'load' },

  // ---- Part 1: the agent exchanges (shape: agent). The video's caption order: intro, run, sign-in, exchange, token, door, tools, refused frame, refused.
  { key: 'p1_intro', type: 'bubble', trigger: 'load', target: SHAPES_GROUP, prefer: 'below', modes: ['real'] },
  { key: 'p1_run', type: 'bubble', trigger: 'load', target: RUN_BTN, prefer: 'above', modes: ['real'] },
  { key: 'p1_signin', type: 'bubble', trigger: 'frame', popout: { frame: 1, section: 'Decoded' }, prefer: 'left', modes: ['real'] },
  { key: 'p1_exchange', type: 'bubble', trigger: 'frame', popout: { frame: 2, section: 'Sent' }, prefer: 'left', modes: ['real'], lines: 'exchLines' },
  { key: 'p1_token', type: 'bubble', trigger: 'frame', popout: { frame: 2, section: 'Decoded' }, prefer: 'left', modes: ['real'] },
  { key: 'p1_door', type: 'bubble', trigger: 'frame', popout: { frame: 3, section: null }, prefer: 'left', modes: ['real'] },
  { key: 'p1_tools', type: 'bubble', trigger: 'frame', popout: { frame: 3, section: 'Came back' }, prefer: 'left', modes: ['real'] },
  { key: 'p1_refused_frame', type: 'bubble', trigger: 'frame', target: '[data-testid=frame-4]', prefer: 'below', modes: ['real'] },
  { key: 'p1_refused', type: 'bubble', trigger: 'frame', popout: { frame: 4, section: 'Came back' }, prefer: 'left', modes: ['real'] },
  { key: 'contrast1', type: 'slide', trigger: 'load' },

  // ---- Part 2: the gateway exchanges too (shape: gateway)
  { key: 'console_obo', type: 'slide', trigger: 'load' },
  { key: 'p2_intro', type: 'bubble', trigger: 'load', target: SHAPES_GROUP, prefer: 'below', modes: ['real'] },
  { key: 'p2_run', type: 'bubble', trigger: 'load', target: RUN_BTN, prefer: 'above', modes: ['real'] },
  { key: 'p2_exchange', type: 'bubble', trigger: 'frame', popout: { frame: 2, section: 'Sent' }, prefer: 'left', modes: ['real'], lines: 'exchLines' },
  { key: 'p2_door', type: 'bubble', trigger: 'frame', popout: { frame: 3, section: null }, prefer: 'left', modes: ['real'] },
  { key: 'p2_whoami', type: 'bubble', trigger: 'frame', popout: { frame: 4, section: 'What the backend' }, prefer: 'left', modes: ['real'] },
  { key: 'p2_act', type: 'bubble', trigger: 'frame', popout: { frame: 4, section: null, detail: true }, prefer: 'left', modes: ['real'] },
  { key: 'p2_refused_frame', type: 'bubble', trigger: 'frame', target: '[data-testid=frame-5]', prefer: 'below', modes: ['real'] },
  { key: 'p2_refused', type: 'bubble', trigger: 'frame', popout: { frame: 5, section: 'Came back' }, prefer: 'left', modes: ['real'] },
  { key: 'contrast2', type: 'slide', trigger: 'load' },

  // Story only (the video shows its captured observability slide instead): the lab's live Run Observability panel, skipped when there is no record.
  { key: 'story_observability', type: 'bubble', trigger: 'load', target: OBS_PANEL, prefer: 'above' },

  // ---- the Mock walk: the flow sim replays a recorded shape (nothing calls a live tenant)
  { key: 'sample_walk_intro', type: 'bubble', trigger: 'load', target: MOCK_PANEL, prefer: 'below', modes: ['mock'] },

  { key: 'closing', type: 'slide', trigger: 'load' },
];

// Bubbles only Story has (the video has no such scene): the live observability panel and the Mock walk's intro.
// The numbered counts and the order checks against take.py leave them out.
export const STORY_ONLY = ['story_observability', 'sample_walk_intro'];
// Wording only the video uses: the captured-evidence slide (Story shows the live panel instead) and the video's SAMPLE-mode opening line.
export const VIDEO_ONLY = ['observability', 'sample_opening_verdict'];

// The Mock wording keys the steps use, plus the closing slide's replaced line (the simulated run never claims a live one).
export const EXTRA_SAMPLE_KEYS = ['sample_walk_intro', 'sample_closing_lead'];

// What the parity test hands to captions.js parity(): the caption keys this script needs.
export function scriptKeys() {
  return {
    steps: STEPS.filter((s) => s.type === 'bubble').map((s) => s.key),
    slides: STEPS.filter((s) => s.type === 'slide').map((s) => s.key),
    sampleKeys: [...STEPS.map((s) => s.sampleKey).filter(Boolean), ...EXTRA_SAMPLE_KEYS],
  };
}
