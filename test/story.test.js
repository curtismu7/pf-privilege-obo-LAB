import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { CAPTIONS_PATH, loadCaptions, resetCaptionsCache, storyResponse } from '../server/src/storyRoute.js';
import { parity } from '../server/src/story/captions.js';
import { checkPin } from '../scripts/story-checkPin.mjs';
import { EXTRA_SAMPLE_KEYS, STEPS, STORY_ONLY, VIDEO_ONLY, scriptKeys } from '../web/src/storyScript.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const steps = STEPS;

test('story: the vendored Story files match their pin (an edited copy fails CI)', () => {
  assert.deepEqual(checkPin(root), []);
});

test('story: every caption key has a step in the script and every step has wording (the parity test)', () => {
  const problems = parity(loadCaptions(), scriptKeys(), { allowUnused: VIDEO_ONLY });
  assert.deepEqual(problems, []);
});

test('story: the parity check really fails when the wording and the script drift', () => {
  const captions = loadCaptions();
  const missingWording = { ...captions, steps: Object.fromEntries(Object.entries(captions.steps).filter(([k]) => k !== 'p1_intro')) };
  assert.deepEqual(parity(missingWording, scriptKeys(), { allowUnused: VIDEO_ONLY }), ['the demo has step "p1_intro" but captions.md does not']);
  const extra = { ...scriptKeys(), steps: [...scriptKeys().steps, 'brand_new'] };
  assert.deepEqual(parity(captions, extra, { allowUnused: VIDEO_ONLY }), ['the demo has step "brand_new" but captions.md does not']);
});

test('story: the script has the same number of numbered bubbles as the recorded video (17 live), plus Story-only bubbles on top', () => {
  const bubbles = (mode) => steps.filter((s) => s.type === 'bubble' && !STORY_ONLY.includes(s.key) && (!s.modes || s.modes.includes(mode))).length;
  assert.equal(bubbles('real'), 17);   // the video's own scenes; Story adds its live observability bubble on top (STORY_ONLY)
  assert.deepEqual(STORY_ONLY, ['story_observability', 'sample_walk_intro']);
  const video = readFileSync(join(root, 'video/take.py'), 'utf8');
  assert.match(video, /TOTAL = 17/);
});

test('story: the bubbles come in the same order as in take.py, and the mode flags sit on the same steps', () => {
  const video = readFileSync(join(root, 'video/take.py'), 'utf8');
  const literal = [...video.matchAll(/\bbubble\("([a-z0-9_]+)"/g)].map((m) => m[1]);
  const part = (prefix, rest) => [`${prefix}_intro`, `${prefix}_run`, ...rest];
  const p1 = part('p1', literal.filter((k) => k.startsWith('p1_')));
  const p2 = part('p2', literal.filter((k) => k.startsWith('p2_')));
  const order = [...p1, ...p2];   // the video's order: each part's intro and run, then that part's scene bubbles
  assert.deepEqual(steps.filter((s) => s.type === 'bubble' && !STORY_ONLY.includes(s.key)).map((s) => s.key), order);
  const realOnly = steps.filter((s) => s.modes?.includes('real') && !s.modes.includes('mock')).map((s) => s.key);
  assert.deepEqual(realOnly, order);   // every video bubble is a Real-page bubble
  assert.deepEqual(steps.filter((s) => s.modes?.includes('mock') && !s.modes.includes('real')).map((s) => s.key), ['sample_note', 'sample_walk_intro']);
});

test('story (rule 29): the first page the viewer sees, in Real and in Mock, has a header naming the demo', () => {
  const captions = loadCaptions();
  for (const mode of ['real', 'mock']) {
    const first = steps.find((s) => !s.modes || s.modes.includes(mode));
    assert.equal(first.type, 'slide', `${mode}: the first page is a slide`);
    const slide = first.key === 'opening' ? captions.opening : captions.slides[first.key];
    assert.ok(slide && slide.header && slide.header.length > 3, `${mode}: "${first.key}" has a header`);
  }
  assert.equal(captions.opening.header, 'On-behalf-of (OBO) in PingOne Privilege');
});

test('story: every step is well formed (a known trigger and type, Mock wording that exists, no twin keys)', () => {
  const captions = loadCaptions();
  const keys = steps.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'no key twice');
  for (const s of steps) {
    assert.ok(['load', 'run-done', 'frame'].includes(s.trigger), `${s.key}: trigger`);
    assert.ok(['bubble', 'slide'].includes(s.type), `${s.key}: type`);
    if (s.sampleKey) assert.ok(captions.steps[s.sampleKey], `${s.key}: Mock wording "${s.sampleKey}" exists`);
  }
  for (const k of EXTRA_SAMPLE_KEYS) assert.ok(captions.steps[k], `${k} exists`);
});

test('story: captions.md and the script are public-safe (no internal host, tenant id, key or screenshot data)', () => {
  const text = readFileSync(CAPTIONS_PATH, 'utf8') + readFileSync(join(root, 'web/src/storyScript.js'), 'utf8');
  assert.equal(/ping-devops|procyon|\.local\b|sk-ant|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), false);
});

test('story: storyResponse serves the parsed wording, and a broken file is a 500 that names the problem (never a crash)', () => {
  const ok = storyResponse();
  assert.equal(ok.status, 200);
  const body = ok.body;
  assert.ok(body.opening.title && body.steps.p1_intro);
  assert.equal(body.sourceSha256, createHash('sha256').update(readFileSync(CAPTIONS_PATH)).digest('hex'), 'the wording says which bytes it came from');
  const dir = mkdtempSync(join(tmpdir(), 'story-'));
  const bad = join(dir, 'captions.md');
  writeFileSync(bad, '# Step: x\n\n## Title\nonly a title\n');
  const broken = storyResponse(bad);
  assert.equal(broken.status, 500);
  assert.match(broken.body.error, /^Story wording could not be read: captions\.md: step "x" needs both a "## Title" and a "## Text" section$/);
  const missing = storyResponse(join(dir, 'missing.md'));
  assert.equal(missing.status, 500);
  assert.equal(missing.body.error, 'Story wording could not be read: the wording file is missing or unreadable.');
  assert.equal(JSON.stringify(missing.body).includes(dir), false, 'the 500 never carries a server path');
  resetCaptionsCache();
});

test('story: a fix to captions.md shows without a restart (the wording is read again when the file changes)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'story-'));
  const file = join(dir, 'captions.md');
  const slide = (t) => `# Opening Slide\n\n## Header\nh\n\n## Title\n${t}\n\n## Lead\nl\n\n## Column A: a\n- x\n\n## Column B: b\n- y\n\n## Verdict\nv\n\n---\n\n`;
  const doc = (t) => slide(t) + slide('c').replace('# Opening Slide', '# Closing Slide');
  writeFileSync(file, doc('first'));
  assert.equal(loadCaptions(file).opening.title, 'first');
  writeFileSync(file, doc('second'));
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(loadCaptions(file).opening.title, 'second');
});

test('story: an edit that keeps the same timestamp still shows, and the served hash always matches the served wording (one read)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'story-'));
  const file = join(dir, 'captions.md');
  const slide = (t) => `# Opening Slide\n\n## Header\nh\n\n## Title\n${t}\n\n## Lead\nl\n\n## Column A: a\n- x\n\n## Column B: b\n- y\n\n## Verdict\nv\n\n---\n\n`;
  const doc = (t) => slide(t) + slide('c').replace('# Opening Slide', '# Closing Slide');
  writeFileSync(file, doc('first'));
  const when = new Date(Date.now() - 60_000);
  utimesSync(file, when, when);
  const a = storyResponse(file).body;
  assert.equal(a.opening.title, 'first');
  assert.equal(a.sourceSha256, createHash('sha256').update(readFileSync(file)).digest('hex'));
  writeFileSync(file, doc('other'));
  utimesSync(file, when, when);            // new bytes, the very same timestamp
  const b = storyResponse(file).body;
  assert.equal(b.opening.title, 'other');
  assert.notEqual(b.sourceSha256, a.sourceSha256);
});

test('story: no console screenshot is tracked, and the assets folder is ignored (the repo is public)', () => {
  let tracked = null;
  try {
    tracked = execFileSync('git', ['ls-files', '--', 'video/assets', '*.jpg', '*.jpeg', '*.png'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { /* no git here: the ignore rule above still ran */ }
  if (tracked) assert.deepEqual(tracked, []);
});

test('story: the video reads its wording from the running lab and carries no copy of the shared overlay or holds (video/test_story_bridge.py)', () => {
  const video = readFileSync(join(root, 'video/take.py'), 'utf8');
  assert.match(video, /from story_bridge import/);
  assert.match(video, /captions\.load\(APP/);
  for (const gone of ['OVERLAY = r"""', 'def hold(', 'def hold_slide(', '* 0.30 + 2.2', '* 0.25 + 3.0']) {
    assert.equal(video.includes(gone), false, `take.py must not carry its own copy of shared logic (${gone})`);
  }
});
