# OBO video (standalone lab): two parts, the agent exchanges, then the gateway does

## Watch the videos (no setup needed)

The published cuts are committed in this repo and safe to share inside the company:

- [`video/releases/2026-11-25-monitor.mp4`](releases/2026-11-25-monitor.mp4) — 1920x1080, for a large display
- [`video/releases/2026-11-25-laptop.mp4`](releases/2026-11-25-laptop.mp4) — 1800x1168, the same run at laptop text size

Download and play in any video player; no sound, captions are on screen.

## Secrets in the videos

Real hosts never appear: the take masks the screen before anything is drawn, rewriting the PingFederate and gateway hosts to `pingfederate.example` / `gateway.example`, and fails itself if a masked host surfaces again after a caption or slide. The tokens are shown in full beside their decoded claims — that is the family's demo convention (owner, 2026-11-22); they carry only the demo user's claims and are short-lived (ID token 300 s, access token 3600 s). Client secrets and the user's password are never on screen. Both cuts passed the take's own host-leak gate (`result.json ok`, no `host_leaks`) plus OCR over 144 extracted frames and a visual review before being committed.

## What you need to run the lab yourself

Docker (OrbStack), then from the repo root `docker compose build && docker compose up`, and open the lab URL the compose output prints. The lab works in Mock mode offline; Real mode (what the video shows) needs your own PingFederate and Privilege setup.

---

Follows the demo family's video standards: `VIDEO-BEST-PRACTICES.md` (copy of the canonical file). Order of work:
`SCRIPT.md` (sources first) -> `captions.md` (wording) -> **sample** -> review -> live take.

- Part 1 (Agent-side, Pass Agent Token): the person signs in, the agent exchanges at PingFederate, the door accepts the token, then a made-up token is refused.
- Part 2 (Gateway OBO, Auth Mode obo): the same exchange, the gateway makes a second one, the backend reports what it received, then a made-up token is refused.
- The page is the lab's Real page; each numbered frame is opened as a pop-out at the key moments.

## Sample (a stand-in, headless, labelled SAMPLE: no tenant, no live calls)

    VIDEO_STATE=$TMPDIR/obo-video video/services.sh start     # from the repo root: stand-in :6990, sample lab :6991 (Real mode)
    SAMPLE=1 PROFILE=monitor python3 video/take.py out/sample-monitor   # -> out/sample-monitor/sample.mp4
    SAMPLE=1 PROFILE=laptop  python3 video/take.py out/sample-laptop
    VIDEO_STATE=$TMPDIR/obo-video video/services.sh stop

Rehearsal (fast, no video; `REHEARSE_SHOTS=dir` keeps a still per caption and slide): add `REHEARSE=1`.

## Live take (the lab on :7812 in Real mode, its own `.env` complete; the take refuses to run otherwise)

Two segments, joined (the observability slide is built from the log capture taken straight after the main segment):

    HEADLESS_REAL=1 PROFILE=monitor SEGMENT=main python3 video/take.py out/live-monitor     # open slide to the last contrast slide
    # capture the logs for exactly this window (SCRIPT.md, "The observability slide"); write out/live-monitor/obs/obs-slide.json if the rows come from logs
    HEADLESS_REAL=1 PROFILE=monitor SEGMENT=end  python3 video/take.py out/live-monitor     # observability slide, then the close
    video/join.sh out/live-monitor/take-headless-main.mp4 out/live-monitor/take-headless-end.mp4 ~/Development/a2a-video-out/obo-monitor.mp4

Same for `PROFILE=laptop` (`obo-laptop.mp4`). `take.py` saves the lab's run record right after each run (`obs/*-record.json`) and refuses to
claim success (`result.json`) unless both parts showed the expected frames, `act` named the agent, the backend's actor nested the gateway
and the agent, the person stayed the subject, and each refusal was a 401 with `resource_metadata`.

Needs node (with the repo's `node_modules`), python3 with playwright and pillow, ffmpeg. New recordings are written to `out/` (gitignored); only the published, gated cuts under `video/releases/` are committed. `out/` and `assets/` are gitignored (recordings and
console screenshots can carry internal hostnames). The sample uses placeholder names only; the live take shows the lab's real ones on screen
(the owner's call before sharing outside the company).
