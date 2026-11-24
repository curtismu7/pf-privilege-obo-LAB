#!/usr/bin/env python3
"""The two-part OBO take: opens its own 'Google Chrome for Testing' window (or a headless one) on the lab's Real page and records it.
Part 1 runs the agent-side shape (the agent exchanges at PingFederate, the door checks the token, then a refused call); Part 2 runs the
gateway OBO shape (the gateway makes a second exchange and the backend reports what it received, then a refused call), with numbered captions
and the lab's frame pop-outs opened at the key frames. Adapted from the AWS A2A take (privilege-a2a-anthropic-demo-LAB/video).

Usage: python3 take.py <work_dir>
  work_dir gets: ready.json (window geometry), take log, result.json, the recording, and obs/ (the lab's run record saved right after each run).
  SEGMENT=all|main|end: main = open slide to the last contrast slide; end = the observability slide and the close (built from obs/ after the
  logs are captured); all = both in one file (the sample). Join main and end with video/join.sh.

Which screen: MONITOR picks "medium" (an external monitor the window is placed on; default) or "laptop" (the
built-in display, for a laptop-only setup). The window SIZE is the same either way (1440x980) and fits
comfortably on both. avfoundation's screen device NUMBERS are not stable on this machine - they shift whenever
a camera connects (an iPhone via Continuity Camera adds two more entries ahead of the screens, for example) -
so this never hardcodes one: at startup, the window briefly paints itself solid green and a quick capture from
every "Capture screen N" device picks out whichever one actually shows it. Set CAPTURE_DEVICE to skip this and
force a specific index (faster, but only safe if you just calibrated and nothing has changed since).
"""
import json, os, re, signal, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64
from captions import OPENING_SLIDE, CLOSING_SLIDE, STEPS, SLIDES

WORK = Path(sys.argv[1] if len(sys.argv) > 1 else "take-work").resolve()
# Two videos, one per screen (owner, 2026-11-22): the window is full screen (Chrome --kiosk) so the video fills the display.
#   PROFILE=monitor  the middle 1920x1080 monitor: large app font (L) and large slides and captions
#   PROFILE=laptop   the built-in display (1800x1169 points): small app font (S) so busy screens fit; slides and captions at normal size
PROFILE = os.environ.get("PROFILE", "monitor")
PROFILES = {"monitor": dict(monitor="medium", display=(1920, 1080), font="L", scale=1.3, dsf=1, video=(1920, 1080)),
            "laptop":  dict(monitor="laptop", display=(1800, 1169), font="S", scale=1.0, dsf=2, video=(2400, 1558))}
_prof = PROFILES[PROFILE]
FONT = os.environ.get("FONT", _prof["font"]); SCALE = float(os.environ.get("SCALE", _prof["scale"]))
MONITOR = os.environ.get("MONITOR", _prof["monitor"])        # "medium" (the middle external monitor) or "laptop" (built-in display)
# Each preset's own global top-left in Quartz/Chromium coordinates (top-left origin, Y grows downward - NOT the
# bottom-left/Y-up convention AppKit's NSScreen reports). "medium" was measured once against a real monitor
# arrangement; "laptop" is exact by definition (a display's own top-left is Quartz (0, 0) only for the main
# display, which the built-in one is on a laptop with no other display marked main).
# The window sits at the display's own top-left and is made full screen. Re-read the layout before a take (NSScreen frames: Quartz y = main height - (y + h)).
PRESETS = {"medium": {"origin": (-1920, -905), "win": (-1920, -905)}, "laptop": {"origin": (0, 0), "win": (0, 0)}}
_preset = PRESETS.get(MONITOR, PRESETS["medium"])
ORIGIN_X, ORIGIN_Y = int(os.environ.get("DISPLAY_X", _preset["origin"][0])), int(os.environ.get("DISPLAY_Y", _preset["origin"][1]))
WIN_X, WIN_Y = int(os.environ.get("WIN_X", _preset["win"][0])), int(os.environ.get("WIN_Y", _preset["win"][1]))
WIN_W, WIN_H = _prof["display"]   # the window is the whole display
OUT_W = int(os.environ.get("OUT_W", 2400))   # a retina capture (3600 px wide on the laptop) is scaled down to this width: a full-size encode stalls and loses the file
REHEARSE = os.environ.get("REHEARSE") == "1"   # headless, no recording, no waiting for a person (runs against whatever route the app has: live or the local stand-in)
SAMPLE = os.environ.get("SAMPLE") == "1"       # preview: headless, full timing, records with Playwright, mock stand-in allowed, labelled SAMPLE in the video
HEADLESS_REAL = os.environ.get("HEADLESS_REAL") == "1"   # the REAL take (live route, Real mode, all checks) recorded headless by Playwright, for when the screen is locked or off
RECORD_PW = (SAMPLE or HEADLESS_REAL) and not REHEARSE
HEADLESS = REHEARSE or SAMPLE or HEADLESS_REAL
WAIT_GO = os.environ.get("WAIT_GO") == "1"     # wait for go.flag before recording (default: start after the calibration, no sign-in is needed here)
THEME = os.environ.get("THEME", "light")         # "dark" or "light": the page theme shown throughout the take (standard, 2026-11-21: light by default)
SEGMENT = os.environ.get("SEGMENT", "all")      # "all" | "main" | "end" (the live take is two segments joined; the sample is one)
APP = os.environ.get("APP_URL", "http://127.0.0.1:6991" if os.environ.get("SAMPLE") == "1" else "http://127.0.0.1:7812")   # the lab (the sample's private lab is :6991, the live lab :7812)
OBS = Path(os.environ.get("OBS_DIR", str(WORK / "obs")))   # the lab's run record, saved right after each run (the observability slide reads it)
def log(*a):
    WORK.mkdir(parents=True, exist_ok=True)
    with (WORK / "take.log").open("a") as f:
        print(*a, file=f, flush=True)

def list_screen_devices():
    """The avfoundation device numbers currently labelled "Capture screen N" - never hardcoded, since a camera
    connecting or disconnecting (including an iPhone via Continuity Camera) shifts every index after it."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
                         capture_output=True, text=True, timeout=15).stderr
    return [int(m.group(1)) for m in re.finditer(r"\[(\d+)\] Capture screen \d+", out)]

def detect_capture_device(work):
    """Which of the current "Capture screen N" devices actually shows this window: paint the page solid green,
    grab one frame from each candidate, and pick whichever has a large contiguous green run (a plain "any green
    pixel" test false-positives on a green-ish desktop wallpaper). Raises with a clear message if none match,
    rather than silently guessing wrong and recording the wrong screen."""
    from PIL import Image
    candidates = list_screen_devices()
    if not candidates:
        raise RuntimeError("no avfoundation 'Capture screen N' device found - is Screen Recording permission granted?")
    best = (None, 0)
    for dev in candidates:
        frame = work / f"_calib_{dev}.png"
        r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "avfoundation",
                           "-framerate", "30", "-pixel_format", "uyvy422", "-i", f"{dev}:none", "-frames:v", "1", str(frame)],
                          capture_output=True, timeout=15)
        if r.returncode != 0 or not frame.exists():
            continue
        im = Image.open(frame).convert("RGB")
        w, h = im.size
        px = im.load()
        matched = 0
        for y in range(0, h, 3):
            run = 0
            for x in range(w):
                px_r, px_g, px_b = px[x, y]
                if px_g > 120 and px_g > px_r * 2.2 and px_g > px_b * 2.2:
                    run += 1
                    if run > w * 0.3:
                        matched += run
                else:
                    run = 0
        frame.unlink(missing_ok=True)
        log("calibration: device", dev, "matched", matched)
        if matched > best[1]:
            best = (dev, matched)
    if best[0] is None:
        raise RuntimeError(f"calibration found the green marker on none of {candidates} - the window may be off-screen for this MONITOR preset")
    return best[0]

OVERLAY = r"""
(() => {
  if (window.__cm) return;
  const S = window.__cmScale || 1; const px = (n) => Math.round(n * S) + 'px';
  const css = `
  .cm-hl{position:fixed;z-index:2147483644;border:3px solid #ff3b57;border-radius:10px;box-shadow:0 0 0 9999px rgba(8,10,13,.28);pointer-events:none;transition:all .25s}
  .cm-bub{box-sizing:border-box;position:fixed;z-index:2147483645;width:${px(470)};background:#f7f8fc;color:#14202e;border:3px solid #e3002b;border-radius:20px;padding:${px(14)} ${px(20)} ${px(14)} ${px(64)};font:${px(18)}/1.4 system-ui,sans-serif;box-shadow:0 14px 36px rgba(0,0,0,.55)}
  .cm-bub .n{position:absolute;left:${px(14)};top:${px(14)};width:${px(36)};height:${px(36)};border-radius:50%;background:#e3002b;color:#fff;font:700 ${px(19)}/${px(36)} system-ui;text-align:center}
  .cm-bub h3{margin:0 0 4px;font-size:${px(19)};color:#14202e !important;font-weight:800}
  .cm-bub p{margin:0;color:#233044}
  .cm-bub ul{margin:8px 0 0;padding:0;list-style:none}
  .cm-bub li{margin:6px 0;padding:6px 9px;background:#e8ebf3;border-radius:6px;font:${px(15)}/1.5 ui-monospace,Menlo,monospace;color:#051727;font-weight:600;word-break:break-word;overflow-wrap:anywhere}
  .cm-bub .of{position:absolute;right:14px;top:10px;font-size:${px(12)};color:#5b667a}
  .cm-tail{position:absolute;width:22px;height:22px;background:#f7f8fc;border:3px solid #e3002b;transform:rotate(45deg)}
  .cm-pill{position:fixed;right:14px;bottom:12px;z-index:2147483646;background:#1d232b;color:#f2f4f7;border:1px solid #3a4350;border-radius:999px;padding:4px 14px;font:700 13px system-ui,sans-serif;pointer-events:none}
  .cm-slide{box-sizing:border-box;position:fixed;z-index:2147483647;inset:0;display:flex;align-items:center;justify-content:center;background:#051727;font:17px/1.5 system-ui,sans-serif;padding:24px}
  .cm-slide .card{zoom:${S};box-sizing:border-box;width:min(1100px,calc(94vw / ${S}));max-height:calc(92vh / ${S});overflow-y:auto;background:#0f2236;color:#f2f4f7;border:3px solid #e3002b;border-radius:24px;padding:32px 40px;box-shadow:0 24px 60px rgba(0,0,0,.6)}
  .cm-slide h1{margin:0 0 10px;font-size:32px;font-weight:800;color:#fff}
  .cm-slide .lead{margin:0 0 20px;color:#c7d0dc;font-size:19px}
  .cm-slide .cols{display:grid;grid-template-columns:1fr 1fr;gap:28px}
  @media (max-width:760px){ .cm-slide .cols{grid-template-columns:1fr} }
  .cm-slide .card.withimg{width:min(1400px,calc(98vw / ${S}))}
  .cm-slide .card.withimg h1{font-size:28px;margin-bottom:6px}.cm-slide .card.withimg .lead{margin-bottom:12px}
  .cm-slide .split{display:grid;grid-template-columns:1.25fr 1fr;gap:26px;align-items:start;margin-bottom:6px}
  .cm-slide .split img{width:100%;border-radius:10px;border:1px solid #2a3b52;background:#fff}
  .cm-slide .col h2{margin:0 0 8px;font-size:19px;color:#8fbcff}
  .cm-slide .col.colb h2{color:#ffb4a8}
  .cm-slide .col ul{margin:0;padding-left:20px}
  .cm-slide .col li{margin:7px 0;font-size:18px}
  .cm-slide .verdict{margin:22px 0 0;padding-top:16px;border-top:1px solid #2a3b52;font-weight:700;color:#fff;font-size:18px}
  .reel-backdrop{justify-content:flex-start !important;padding-left:20px !important}
  .reel-dialog{width:min(${Math.round(880 * S)}px,100%) !important}`;
  const root = () => document.documentElement;
  const ensure = () => { if (!root() || document.getElementById('cm-style')) return; const st = document.createElement('style'); st.id = 'cm-style'; st.textContent = css; root().appendChild(st);
    const pill = document.createElement('div'); pill.className = 'cm-pill'; pill.textContent = window.__pillText || ''; if (!window.__pillText) pill.style.display = 'none'; root().appendChild(pill); };
  document.addEventListener('DOMContentLoaded', ensure); ensure();
  const els = []; const clear = () => { while (els.length) els.pop().remove(); };
  window.__authUrl = null; 
  window.__cm = { clear, slide(o) {
    ensure(); clear();
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<h1></h1><p class="lead"></p><div class="cols">
      <div class="col cola"><h2></h2><ul></ul></div>
      <div class="col colb"><h2></h2><ul></ul></div></div><p class="verdict"></p>`;
    card.querySelector('h1').textContent = o.title;
    card.querySelector('.lead').textContent = o.lead;
    card.querySelector('.cola h2').textContent = o.cola.h;
    card.querySelector('.cola ul').append(...o.cola.lines.map((l) => { const li = document.createElement('li'); li.textContent = l; return li; }));
    card.querySelector('.colb h2').textContent = o.colb.h;
    card.querySelector('.colb ul').append(...o.colb.lines.map((l) => { const li = document.createElement('li'); li.textContent = l; return li; }));
    card.querySelector('.verdict').textContent = o.verdict;
    if (o.image) { card.classList.add('withimg'); const split = document.createElement('div'); split.className = 'split'; const im = document.createElement('img'); im.src = o.image; im.alt = 'Screenshot of the Privilege console'; const cols = card.querySelector('.cols'); if (o.wide) { split.style.gridTemplateColumns = '1fr'; cols.parentNode.insertBefore(split, cols); split.append(im); } else { cols.style.gridTemplateColumns = '1fr'; cols.parentNode.insertBefore(split, cols); split.append(im, cols); } }
    // Belt and suspenders on top of the CSS max-height: an explicit pixel value computed from the real
    // viewport, so this never depends on vh units resolving the way a particular Chromium build expects.
    card.style.maxHeight = Math.round(innerHeight * 0.88 / S) + 'px';
    const wrap = document.createElement('div'); wrap.className = 'cm-slide'; wrap.append(card);
    root().appendChild(wrap); els.push(wrap);
  }, cap(o) {
    ensure(); clear();
    const vw = innerWidth, vh = innerHeight, W = Math.round(470 * S), GAP = 26, M = 12;
    const t = o.target ? document.querySelector(o.target) : null;
    // Scroll the target's own panel so it is on screen before measuring it: otherwise a sidebar field, a reel
    // frame or a step-detail row that has scrolled out of view gets highlighted in the wrong place, or the
    // viewer never actually sees what the caption is pointing at.
    if (t) t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const r = t ? t.getBoundingClientRect() : null;
    if (r) { const h = document.createElement('div'); h.className = 'cm-hl'; h.style.cssText = `left:${r.left-5}px;top:${r.top-5}px;width:${r.width+10}px;height:${r.height+10}px`; root().appendChild(h); els.push(h); }
    const b = document.createElement('div'); b.className = 'cm-bub';
    b.innerHTML = `<span class="n"></span><span class="of"></span><h3></h3><p></p>` + (o.lines ? '<ul>' + o.lines.map(() => '<li></li>').join('') + '</ul>' : '');
    b.querySelector('.n').textContent = o.n; b.querySelector('.of').textContent = o.n + ' of ' + o.total;
    b.querySelector('h3').textContent = o.title; b.querySelector('p').textContent = o.text;
    (o.lines || []).forEach((l, i) => { b.querySelectorAll('li')[i].textContent = l; });
    b.style.visibility = 'hidden'; root().appendChild(b); els.push(b);
    const H = b.getBoundingClientRect().height;
    let left, top, side = null;
    if (o.place === 'bl') { left = M + 8; top = vh - H - 24; }
    else if (!r) { left = (vw - W) / 2; top = vh - H - 40; }
    else {
      const fits = { right: r.right + GAP + W + M <= vw, left: r.left - GAP - W >= M, below: r.bottom + GAP + H + M <= vh, above: r.top - GAP - H >= M };
      const order = o.prefer ? [o.prefer, 'right', 'left', 'below', 'above'] : ['right', 'left', 'below', 'above'];
      side = order.find((s) => fits[s]) || (vw - r.right > r.left ? 'right' : 'left');
      if (side === 'right') { left = r.right + GAP; top = r.top + r.height / 2 - H / 2; }
      else if (side === 'left') { left = r.left - GAP - W; top = r.top + r.height / 2 - H / 2; }
      else if (side === 'below') { left = r.left + r.width / 2 - W / 2; top = r.bottom + GAP; }
      else { left = r.left + r.width / 2 - W / 2; top = r.top - GAP - H; }
    }
    left = Math.max(M, Math.min(vw - W - M, left)); top = Math.max(M, Math.min(vh - H - M, top));
    b.style.left = left + 'px'; b.style.top = top + 'px'; b.style.visibility = 'visible';
    if (r && side && o.place !== 'bl') {
      const tail = document.createElement('div'); tail.className = 'cm-tail';
      const cx = Math.max(left + 26, Math.min(left + W - 26, r.left + r.width / 2)), cy = Math.max(top + 26, Math.min(top + H - 26, r.top + r.height / 2));
      if (side === 'right') { tail.style.left = '-13px'; tail.style.top = (cy - top - 11) + 'px'; tail.style.borderRight = 'none'; tail.style.borderTop = 'none'; }
      if (side === 'left') { tail.style.right = '-13px'; tail.style.top = (cy - top - 11) + 'px'; tail.style.borderLeft = 'none'; tail.style.borderBottom = 'none'; }
      if (side === 'below') { tail.style.top = '-13px'; tail.style.left = (cx - left - 11) + 'px'; tail.style.borderBottom = 'none'; tail.style.borderRight = 'none'; }
      if (side === 'above') { tail.style.bottom = '-13px'; tail.style.left = (cx - left - 11) + 'px'; tail.style.borderTop = 'none'; tail.style.borderLeft = 'none'; }
      b.appendChild(tail);
    }
  } };
})();
"""
TOTAL = 17   # numbered caption bubbles (Part 1: 9, Part 2: 8); the take counts them and logs a mismatch
# Frames of a Real run, by number: Part 1 = sign-in, exchange, door, refused; Part 2 = sign-in, exchange, door, whoami, refused.
EXPECT = {"agent": ["ok", "ok", "ok", "refused"], "gateway": ["ok", "ok", "ok", "ok", "refused"]}
SHAPE_BTN = {"agent": "[aria-label='Which shape'] button >> nth=0", "gateway": "[aria-label='Which shape'] button >> nth=1"}

MASK_HOSTS = os.environ.get("MASK_HOSTS", "1") == "1"   # live takes show placeholder hosts, never the real ones (owner, 2026-11-24); MASK_HOSTS=0 to see the real ones
MASK_JS = r"""
(() => {
  const CFG = __CFG__;
  const rules = CFG.rules.map(([src, rep]) => [new RegExp(src, 'gi'), rep]);
  const mask = (s) => { for (const [re, rep] of rules) s = s.replace(re, rep); return s; };
  const text = (n) => { const m = mask(n.nodeValue); if (m !== n.nodeValue) n.nodeValue = m; };
  const fix = (n) => {
    if (n.nodeType === 3) return text(n);
    if (n.nodeType !== 1) return;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) text(t);
    for (const el of [n, ...n.querySelectorAll('[title],[placeholder],[aria-label],[value]')]) for (const a of ['title', 'placeholder', 'aria-label', 'value']) {
      const v = el.getAttribute(a); if (v) { const m = mask(v); if (m !== v) el.setAttribute(a, m); } }
  };
  const start = () => { fix(document.documentElement); document.title = mask(document.title);
    new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'characterData') fix(m.target); else m.addedNodes.forEach(fix); } })
      .observe(document.documentElement, { subtree: true, childList: true, characterData: true }); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  window.__maskLeak = () => { const m = ((document.body && document.body.innerText) || '').match(new RegExp(CFG.leak, 'i')); return m ? m[0] : null; };
})();
"""

def mask_config():
    """Which host names must never show on screen, read at run time from this lab's own .env (never written into the repo): the PingFederate
    host, the gateway door host, any other host the .env names, their parent domain, and in-cluster service names (they carry a namespace)."""
    path = Path(os.environ.get("PFO_ENV_FILE") or (Path(__file__).resolve().parent.parent / ".env"))
    env = {}
    if path.exists():
        for line in path.read_text().splitlines():
            m = re.match(r"\s*([A-Za-z0-9_]+)\s*=\s*(.*)", line)
            if m and not line.lstrip().startswith("#"): env[m.group(1)] = m.group(2).strip().strip("'\"")
    named = {}   # host -> placeholder (the specific hosts first)
    for k, v in env.items():
        for h in re.findall(r"https?://([A-Za-z0-9.-]+)", v):
            ph = "pingfederate.example" if re.search(r"ISSUER|TOKEN_URL|SIGNIN|REDIRECT", k) else ("gateway.example" if "DOOR" in k else "host.example")
            named.setdefault(h.lower(), ph)
    rules = [[re.escape(h), ph] for h, ph in sorted(named.items(), key=lambda x: -len(x[0]))]
    domains = {".".join(h.split(".")[-2:]) for h in named if h.count(".") >= 2}
    rules += [[r"(?:[A-Za-z0-9-]+\.)*" + re.escape(d), "host.example"] for d in sorted(domains)]
    rules.append([r"(?:[A-Za-z0-9-]+\.)+svc\.cluster\.local", "backend.example"])
    leak = "|".join([re.escape(h) for h in named] + [re.escape(d) for d in domains] + [r"svc\.cluster\.local"])
    return {"rules": rules, "leak": leak, "hosts": len(named)}

def hold(text, extra=0.0):
    return max(5.0, len(text.split()) * 0.30 + 2.2) + extra

def slide_payload(cfg):
    """captions.py's flat shape -> the JS slide() function's shape. Edit captions.md, not this."""
    image = None
    if cfg.get("image"):
        raw = (Path(__file__).parent / "assets" / cfg["image"]).read_bytes()
        image = "data:image/jpeg;base64," + base64.b64encode(raw).decode()
    return dict(image=image, title=cfg["title"], lead=cfg["lead"],
                cola=dict(h=cfg["col_a_heading"], lines=cfg["col_a_lines"]),
                colb=dict(h=cfg["col_b_heading"], lines=cfg["col_b_lines"]),
                verdict=cfg["verdict"], wide=bool(cfg.get("wide")))

def slide_hold_text(cfg):
    return " ".join([cfg["lead"], *cfg["col_a_lines"], *cfg["col_b_lines"], cfg["verdict"]])

def hold_slide(cfg, extra=0.0, cap=30.0):
    # Owner rule (2026-11-22): no slide is held longer than 10 seconds. The text in captions.md is trimmed to be skimmed in that time.
    return min(10.0, max(6.0, len(slide_hold_text(cfg).split()) * 0.25 + 3.0))

def first_sentence(s, limit=150):
    """A caption fact line: the text up to its first full stop, never cut mid-word."""
    s = (s or "").strip().split("\n")[0]
    cut = s.find(". ")
    s = s[:cut + 1] if cut > 0 else s
    return s if len(s) <= limit else s[:limit].rsplit(" ", 1)[0] + "..."

def main():
    WORK.mkdir(parents=True, exist_ok=True)
    profile = tempfile.mkdtemp(prefix="obo-take-")
    # No "Save password?" bubble in the recording: switch the password manager off in this throw-away profile.
    (Path(profile) / "Default").mkdir(parents=True, exist_ok=True)
    (Path(profile) / "Default" / "Preferences").write_text(json.dumps({
        "credentials_enable_service": False, "credentials_enable_autosignin": False,
        "profile": {"password_manager_enabled": False}, "autofill": {"profile_enabled": False, "credit_card_enabled": False}}))
    result = {"ok": False}
    with sync_playwright() as pw:
        T0 = time.time(); MARK = {}   # the Playwright video starts when the browser launches
        ctx = pw.chromium.launch_persistent_context(
            profile, headless=HEADLESS, no_viewport=not HEADLESS, viewport={"width": WIN_W, "height": WIN_H} if HEADLESS else None,
            **({"device_scale_factor": _prof["dsf"]} if HEADLESS else {}),   # the laptop is a retina display: render at 2x (screenshots only; the recorded video is a 1x capture of the viewport, scaled up to 2400 px wide when encoded)
            color_scheme="light",
            **({"record_video_dir": str(WORK / "pw-video"), "record_video_size": {"width": WIN_W, "height": WIN_H}} if RECORD_PW else {}),   # the page fills the canvas only if the canvas is the viewport size; scaled to the profile's video size when encoding
            args=[f"--window-position={WIN_X},{WIN_Y}", f"--window-size={WIN_W},{WIN_H}", "--no-first-run", "--no-default-browser-check", *([] if HEADLESS else ["--kiosk"])])
        ctx.add_init_script("window.__cmScale = " + json.dumps(SCALE) + ";")
        ctx.add_init_script("window.__pillText = " + json.dumps("SAMPLE: simulated stand-in, not a live run" if SAMPLE else None) + ";")
        ctx.add_init_script(OVERLAY)
        if MASK_HOSTS and not SAMPLE:
            _mask = mask_config(); log("host masking on:", _mask["hosts"], "hosts from the lab .env")
            ctx.add_init_script(MASK_JS.replace("__CFG__", json.dumps(_mask)))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        # (T0 and MARK are set before the browser launches.) The Playwright video starts with the page: MARK["first"] (the first slide) says how much set-up to cut from its head
        page.goto(APP + "/"); page.wait_for_selector("[data-testid=top-menu]")
        page.select_option("[data-testid=theme-select]", THEME)
        if not HEADLESS:
            subprocess.run(["osascript", "-e", 'tell application "System Events" to set frontmost of (first process whose name is "Google Chrome for Testing") to true'], capture_output=True)
        page.bring_to_front(); page.wait_for_timeout(1500 if HEADLESS else 4500)   # a full-screen window needs a moment to settle

        if HEADLESS:
            DEV = None
        elif os.environ.get("CAPTURE_DEVICE"):
            DEV = os.environ["CAPTURE_DEVICE"]; log("capture device: forced via CAPTURE_DEVICE=", DEV)
        else:
            # Cover body itself (the page paints an opaque background over the viewport) with the green marker.
            page.evaluate("""() => { document.body.style.setProperty('background', '#00FF00', 'important');
                document.body.style.setProperty('min-height', '100vh', 'important'); }""")
            page.wait_for_timeout(500)
            DEV = str(detect_capture_device(WORK))
            page.evaluate("() => { document.body.style.removeProperty('background'); document.body.style.removeProperty('min-height'); }")
            log("capture device: auto-detected", DEV, "for MONITOR=", MONITOR, "at", (WIN_X, WIN_Y))

        g = page.evaluate("() => ({screenX: window.screenX, screenY: window.screenY, outerW: window.outerWidth, outerH: window.outerHeight, innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio})")
        dpr = g["dpr"] or 1   # ffmpeg crops PHYSICAL pixels; window geometry is logical, so scale by devicePixelRatio
        g["crop"] = {"w": round(g["innerW"] * dpr), "h": round(g["innerH"] * dpr),
                     "x": round((g["screenX"] - ORIGIN_X) * dpr), "y": round((g["screenY"] - ORIGIN_Y + (g["outerH"] - g["innerH"])) * dpr)}
        (WORK / "ready.json").write_text(json.dumps(g)); log("ready", g)
        page.evaluate("o => window.__cm.cap(o)", dict(n=0, total=TOTAL, title="Test frame", text="This is the recording area. Nothing is being recorded yet.", target="[data-testid=top-menu]"))
        if WAIT_GO:
            log("waiting for go.flag")
            while not (WORK / "go.flag").exists():
                if (WORK / "abort.flag").exists():
                    log("aborted"); ctx.close(); return
                time.sleep(0.5)
        else:
            page.wait_for_timeout(2000)
        page.evaluate("() => window.__cm.clear()")
        c = g["crop"]
        ff = None if HEADLESS else subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "avfoundation", "-framerate", "30", "-capture_cursor", "1",
                               "-pixel_format", "uyvy422", "-i", f"{DEV}:none", "-vf", f"crop={c['w']}:{c['h']}:{c['x']}:{c['y']}" + (f",scale={OUT_W}:-2" if c["w"] > OUT_W else ""),
                               "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-an", "-t", "900", str(WORK / f"take-{SEGMENT}.mp4")],
                              stdin=subprocess.PIPE, stderr=open(WORK / "ffmpeg.log", "w"))
        log("rehearsal" if REHEARSE else "sample recording started (playwright)" if SAMPLE else "recording started"); time.sleep(0.2 if REHEARSE else 1.5)
        shots = os.environ.get("REHEARSE_SHOTS")
        count = {"n": 0}

        def snap(name):
            if REHEARSE and shots:
                page.wait_for_timeout(300); Path(shots).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(Path(shots) / f"{name}.png"))

        def bubble(key, target=None, lines=None, secs=None, prefer=None, sample_key=None, place=None):
            """One numbered caption. The number is counted here, so a conditional scene never leaves a gap."""
            count["n"] += 1
            if not HEADLESS:
                # the window must still be where the recording crops: a display that sleeps or reconnects moves it, and the video then shows the desktop
                geo = page.evaluate("() => [window.screenX, window.screenY, window.innerWidth, window.innerHeight]")
                if geo != [g["screenX"], g["screenY"], g["innerW"], g["innerH"]]:
                    log("WARNING: the window moved or resized at caption %d (%s, expected %s): this recording is not usable" % (count["n"], geo, [g["screenX"], g["screenY"], g["innerW"], g["innerH"]]))
                    result["window_moved_at"] = count["n"]; result["ok"] = False   # another window (another session's browser, a permission dialog) must never end up in the recording: keep ours in front
                subprocess.run(["osascript", "-e", 'tell application "System Events" to set frontmost of (first process whose name is "Google Chrome for Testing") to true'], capture_output=True)
                page.bring_to_front()
            st = STEPS[sample_key] if (SAMPLE and sample_key) else STEPS[key]
            page.evaluate("o => window.__cm.cap(o)", dict(n=count["n"], total=TOTAL, title=st["title"], text=st["text"], target=target, lines=lines, prefer=prefer, place=place))
            snap(f"step-{count['n']:02d}-{key}")
            leak = page.evaluate("() => window.__maskLeak ? window.__maskLeak() : null")
            if leak: result.setdefault("host_leaks", []).append(f"caption {count['n']}"); log("HOST LEAK on screen at caption", count["n"])
            page.wait_for_timeout(int((secs if secs is not None else hold(st["text"] + " ".join(lines or []))) * 1000 * (0.04 if REHEARSE else 1)))

        def show_slide(cfg, extra=0.0, name="slide", cap=30.0):
            MARK.setdefault("first", time.time())
            page.evaluate("o => window.__cm.slide(o)", slide_payload(cfg))
            snap(name)
            if page.evaluate("() => window.__maskLeak ? window.__maskLeak() : null"): result.setdefault("host_leaks", []).append(name); log("HOST LEAK on screen at slide", name)
            total_ms = int(hold_slide(cfg, extra=extra, cap=cap) * 1000 * (0.04 if REHEARSE else 1))
            pre_ms = min(6000, int(total_ms * 0.45))
            page.wait_for_timeout(pre_ms)
            # Scroll a card taller than the viewport so the verdict line is not cut off in a silent recording.
            page.evaluate("""() => { const c = document.querySelector('.cm-slide .card');
                if (c && c.scrollHeight > c.clientHeight + 4) c.scrollTo({top: c.scrollHeight - c.clientHeight, behavior: 'smooth'}); }""")
            page.wait_for_timeout(max(0, total_ms - pre_ms))
            page.evaluate("() => window.__cm.clear()")

        def tag(selector, ident):
            """Give the first match an id so a caption can point at it (the overlay targets by selector)."""
            page.evaluate("i => document.querySelectorAll('#' + i).forEach((e) => e.removeAttribute('id'))", ident)
            loc = page.locator(selector)
            if loc.count(): loc.first.evaluate("(e, i) => { e.id = i; }", ident)
            else: log("tag: nothing matches", selector)

        DLG = "[data-testid=frame-dialog]"

        def section(startswith):
            """Give the pop-out section whose heading starts with the text an id, so a caption can point at it. Falls back to the whole pop-out."""
            ok = page.evaluate("t => { const s = [...document.querySelectorAll('[data-testid=frame-dialog] section')].find((x) => { const h = x.querySelector('h3'); return h && h.textContent.startsWith(t); }); if (!s) return false; document.querySelectorAll('#cm-sec').forEach((e) => e.removeAttribute('id')); s.id = 'cm-sec'; return true; }", startswith)
            if not ok: log("pop-out section not found:", startswith)
            return "#cm-sec" if ok else DLG

        def open_frame(n):
            page.locator(f"[data-testid=frame-{n}]").scroll_into_view_if_needed(); page.click(f"[data-testid=frame-{n}]")
            page.wait_for_selector(DLG); page.wait_for_timeout(500)

        def close_frame():
            page.evaluate("() => { window.__cm.clear(); }")
            btn = page.locator(f"{DLG} button[title=Close], {DLG} .fd-close-btn")
            if btn.count(): btn.first.click()
            else: page.keyboard.press("Escape")
            page.wait_for_timeout(400)

        def exch_lines():
            """From the open exchange pop-out: which of audience / resource was sent, and the scope. Never a host name or an id."""
            rows = page.evaluate("() => [...document.querySelectorAll('[data-testid=frame-dialog] table.real-params tr')].map((r) => [r.querySelector('th').textContent, r.querySelector('td').textContent])")
            d = dict(rows)
            sent = "audience" if "audience" in d else "resource" if "resource" in d else None
            return [x for x in (f"sent: {sent}" if sent else None, f"scope: {d['scope']}" if d.get("scope") else None) if x]

        def tag_actor():
            """The actor nesting is written out in the pop-out's summary line (the report's own rows show it collapsed): point there."""
            tag("[data-testid=frame-dialog] [data-testid=frame-detail] > p >> nth=0", "cm-act")
            return "#cm-act"

        def save_record(shape, body, later=False):
            """The lab's own run record, read right after the run (and again a few seconds later, when a collector has had time to ship): the observability slide reads these."""
            OBS.mkdir(parents=True, exist_ok=True)
            if not later:
                (OBS / f"{shape}-run.json").write_text(json.dumps({"id": body.get("id"), "ms": body.get("ms"), "frames": [{k: f.get(k) for k in ("n", "title", "state", "summary", "ms")} for f in body["frames"]]}, indent=1))
            rec = page.evaluate("id => fetch('/api/run-observability?runId=' + encodeURIComponent(id) + '&fresh=1').then(async (r) => r.status === 200 ? r.json() : null)", body.get("id"))
            (OBS / f"{shape}-record{'-later' if later else ''}.json").write_text(json.dumps(rec, indent=1))
            return rec

        def run_shape(shape, part):
            """Pick the shape, caption it, press Run live, wait for the numbered frames. Returns the run (the lab's own reply) and whether its frames were the expected ones."""
            page.locator(SHAPE_BTN[shape]).click(); page.wait_for_timeout(400)
            bubble(f"{part}_intro", "[aria-label='Which shape']", prefer="below")
            tag("[data-testid=real-obo-run]", "cm-run")
            bubble(f"{part}_run", "#cm-run", prefer="above")
            page.evaluate("() => window.__cm.clear()")
            with page.expect_response(lambda r: r.url.endswith("/api/real/obo/run") and r.request.method == "POST", timeout=180000) as ri:
                page.click("[data-testid=real-obo-run]")
            body = ri.value.json()
            page.wait_for_selector("[data-testid=real-obo-frames]", timeout=30000)
            page.wait_for_function("!document.querySelector('[data-testid=real-obo-run]').disabled", timeout=30000); page.wait_for_timeout(800)
            got = [f["state"] for f in body.get("frames", [])]
            log(f"{shape}: frames", [(f["n"], f["title"], f["state"]) for f in body.get("frames", [])])
            save_record(shape, body)
            return body, got == EXPECT[shape]

        def claims_of(body, n):
            f = next((x for x in body["frames"] if x["n"] == n), {})
            return ((f.get("token") or {}).get("claims")) or {}

        def obs_cfg():
            """The observability slide: the wording is captions.md; the rows come from this take's own capture. A curated obs/obs-slide.json (written after the
            gateway and backend logs are read) replaces the rows; without one, the rows are the lab's own record of the run, each with its honest tag."""
            cfg = dict(SLIDES["observability"])
            override = OBS / "obs-slide.json"
            if override.exists():
                o = json.loads(override.read_text()); cfg.update({k: o[k] for k in ("lead", "col_a_lines", "col_b_lines", "verdict") if k in o}); return cfg
            tags = {"response": "reply", "logged": "logged", "simulated": "simulated", "not-logged": "not logged"}
            def rec(shape):
                for name in (f"{shape}-record-later.json", f"{shape}-record.json"):
                    p = OBS / name
                    if p.exists():
                        r = json.loads(p.read_text())
                        if r and r.get("rows"): return r
                return None
            r = rec("gateway") or rec("agent")
            def pick(layer, outcome=None):
                rows = [x for x in (r or {}).get("rows", []) if x["layer"] == layer and (outcome is None or x["outcome"] == outcome)]
                return rows[0] if rows else None
            def line(row, words): return f"{row['at'][11:19]}Z {row['layer']}: {words} ({tags.get(row['origin'], row['origin'])})"
            lines = []
            for layer, outcome, words in (("person", None, "sign-in; no PingFederate log line"), ("gateway", "allowed", "door accepted the token"), ("resource", None, "backend reported what it saw"), ("gateway", "refused", "made-up token refused")):
                row = pick(layer, outcome)
                lines.append(line(row, words) if row else f"{layer}: {words.split(';')[0]} (not logged)")
            cfg["col_a_lines"] = lines
            cfg["col_b_lines"] = ["The gateway's log and the console's Activity Logs", "Container logs for the lab and the backend", "All can stream to a SIEM"]
            return cfg

        try:
            if SEGMENT in ("all", "main"):
                if SAMPLE:
                    show_slide(SLIDES["sample_note"], extra=2.0, name="sample_note", cap=22.0)
                opening = dict(OPENING_SLIDE)
                if SAMPLE: opening["verdict"] = STEPS["sample_opening_verdict"]["text"]   # the sample never claims a live run
                show_slide(opening, extra=4.0, name="opening", cap=36.0)
                show_slide(SLIDES["rfc8693"], extra=2.0, name="slide-rfc8693", cap=30.0)

                # The page in Real mode (the sample switches its private lab to Real itself; the live take refuses to run unless the lab already says Real).
                info = page.evaluate("fetch('/api/info').then(r => r.json())")
                if info.get("source") != "real":
                    if not SAMPLE: raise RuntimeError(f"the take needs Real mode (the lab says {info.get('source')!r}); refusing to record a mock")
                    page.evaluate("fetch('/api/mode', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({source: 'real'})}).then(r => r.status)")
                page.goto(APP + "/"); page.wait_for_selector("[data-testid=real-obo]", timeout=30000)
                page.select_option("[data-testid=theme-select]", THEME); page.evaluate("px => { document.documentElement.style.fontSize = px; }", {"S": "14px", "M": "16px", "L": "18px"}[FONT])   # this lab has no font control: set the root size the family menu would (S 14, M 16, L 18)
                obo = page.evaluate("fetch('/api/real/obo').then(r => r.json())")
                if not (obo.get("configured") and obo.get("shapes", {}).get("agent") and obo.get("shapes", {}).get("gateway")):
                    raise RuntimeError("the take needs both shapes configured in the lab's .env (agent door and gateway door)")
                log("lab mode: real | user:", obo.get("user"), "| issuer host:", obo.get("issuerHost"), "| sample:", SAMPLE)
                page.wait_for_timeout(1200)

                # ===================== Part 1: the agent exchanges (Agent-side, Pass Agent Token) =====================
                body1, ok1 = run_shape("agent", "p1")
                id_c, tok_c = claims_of(body1, 1), claims_of(body1, 2)
                act1 = isinstance(tok_c.get("act"), dict) and bool(tok_c["act"].get("sub")) and tok_c.get("sub") == id_c.get("sub")
                door1 = next((f for f in body1["frames"] if f["n"] == 3), {}); tools1 = (door1.get("response") or {}).get("tools") or []
                ref1 = next((f for f in body1["frames"] if f["n"] == 4), {}); ref1_json = json.dumps(ref1.get("response") or {})
                meta1 = "resource_metadata" in ref1_json
                log("part 1: act ok", act1, "| tools", len(tools1), "| refused status", (ref1.get("response") or {}).get("status"), "| resource_metadata in the challenge:", meta1)
                result.update(part1_ok=ok1, part1_act_ok=act1, part1_tools=len(tools1), part1_resource_metadata=meta1, part1_run_id=body1.get("id"))
                ok1 = ok1 and act1 and len(tools1) > 0 and (ref1.get("response") or {}).get("status") == 401 and meta1
                open_frame(1); bubble("p1_signin", section("Decoded"), prefer="left"); close_frame()
                open_frame(2); bubble("p1_exchange", section("Sent"), lines=exch_lines(), prefer="left"); bubble("p1_token", section("Decoded"), prefer="left"); close_frame()
                open_frame(3)
                bubble("p1_door", "[data-testid=frame-inferred]" if page.locator("[data-testid=frame-inferred]").count() else DLG, prefer="left")
                bubble("p1_tools", section("Came back"), prefer="left"); close_frame()
                bubble("p1_refused_frame", "[data-testid=frame-4]", prefer="below")
                open_frame(4); bubble("p1_refused", section("Came back"), prefer="left"); close_frame()
                save_record("agent", body1, later=True)
                if not ok1: log("WARNING: part 1 did not show the expected run (%s); fix and retake" % [f["state"] for f in body1["frames"]])
                show_slide(SLIDES["contrast1"], extra=2.0, name="slide-contrast1", cap=30.0)

                # ===================== Part 2: the gateway exchanges too (Gateway OBO, Auth Mode obo) =====================
                show_slide(SLIDES["console_obo"], extra=2.0, name="slide-console-obo", cap=30.0)
                body2, ok2 = run_shape("gateway", "p2")
                id2, tok2 = claims_of(body2, 1), claims_of(body2, 2)
                who = next((f for f in body2["frames"] if f["n"] == 4), {}); backend = who.get("backend") or {}
                actor = backend.get("actor") or {}
                nested = isinstance(actor.get("act"), dict) and bool(actor["act"].get("sub")) and bool(actor.get("sub"))
                same_person = bool(backend.get("subject")) and backend.get("subject") == tok2.get("sub") == id2.get("sub")
                ref2 = next((f for f in body2["frames"] if f["n"] == 5), {}); meta2 = "resource_metadata" in json.dumps(ref2.get("response") or {})
                log("part 2: backend actor nested", nested, "| same person at the backend", same_person, "| refused status", (ref2.get("response") or {}).get("status"), "| resource_metadata:", meta2)
                result.update(part2_ok=ok2, part2_actor_nested=nested, part2_same_person=same_person, part2_resource_metadata=meta2, part2_run_id=body2.get("id"))
                ok2 = ok2 and nested and same_person and (ref2.get("response") or {}).get("status") == 401 and meta2
                open_frame(2); bubble("p2_exchange", section("Sent"), lines=exch_lines(), prefer="left"); close_frame()
                open_frame(3); bubble("p2_door", DLG, prefer="left"); close_frame()
                open_frame(4); bubble("p2_whoami", section("What the backend"), prefer="left"); bubble("p2_act", tag_actor(), prefer="left"); close_frame()
                bubble("p2_refused_frame", "[data-testid=frame-5]", prefer="below")
                open_frame(5); bubble("p2_refused", section("Came back"), prefer="left"); close_frame()
                save_record("gateway", body2, later=True)
                if not ok2: log("WARNING: part 2 did not show the expected run (%s); fix and retake" % [f["state"] for f in body2["frames"]])
                show_slide(SLIDES["contrast2"], extra=2.0, name="slide-contrast2", cap=30.0)
                result["main_ok"] = bool(ok1 and ok2)
                result["bubbles"] = count["n"]; result["bubbles_expected"] = TOTAL
                if count["n"] != TOTAL: log("NOTE: %d caption bubbles were shown but the counter says %d; set TOTAL to match" % (count["n"], TOTAL))
            if SEGMENT in ("all", "end"):
                if SEGMENT == "end":
                    page.goto(APP + "/"); page.wait_for_selector("[data-testid=top-menu]")
                have = [n for n in ("agent-record.json", "gateway-record.json") if (OBS / n).exists()]
                result["obs_records"] = have
                show_slide(obs_cfg(), extra=2.0, name="slide-observability", cap=30.0)
                closing = dict(CLOSING_SLIDE)
                if SAMPLE: closing["lead"] = STEPS["sample_closing_lead"]["text"]
                show_slide(closing, extra=3.0, name="closing", cap=30.0)
            records_ok = SEGMENT == "main" or len(result.get("obs_records", [])) == 2   # the slide needs both runs' records (or a curated obs-slide.json written after the log capture)
            result["ok"] = bool(result.get("main_ok", True)) and records_ok and "window_moved_at" not in result and not result.get("host_leaks")
            page.evaluate("() => window.__cm.clear()")
        finally:
            log("stopping recording")
            if ff is not None:
                try: ff.send_signal(signal.SIGINT)
                except Exception: pass
                try: ff.wait(timeout=180)   # let the encoder flush and write the mp4 index; killing it early loses the whole recording
                except Exception: ff.kill()
            (WORK / "result.json").write_text(json.dumps(result, indent=1))
            (WORK / "done.flag").write_text("done")
        vpath = page.video.path() if RECORD_PW and page.video else None
        ctx.close()
        if vpath:
            out = WORK / (("sample.mp4" if SEGMENT == "all" else f"sample-{SEGMENT}.mp4") if SAMPLE else f"take-headless-{SEGMENT}.mp4")
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{max(0.0, MARK.get('first', T0) - T0 - 0.3):.2f}", "-i", str(vpath), "-vf", f"scale={_prof['video'][0]}:{_prof['video'][1]}:flags=lanczos", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", str(out)], check=True)
            log("sample video:", out)

if __name__ == "__main__":
    main()
