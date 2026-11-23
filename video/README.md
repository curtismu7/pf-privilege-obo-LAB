# OBO video (standalone lab): two parts, the agent exchanges, then the gateway does

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

Needs node (with the repo's `node_modules`), python3 with playwright and pillow, ffmpeg. `out/` and `assets/` are gitignored (recordings and
console screenshots can carry internal hostnames). The sample uses placeholder names only; the live take shows the lab's real ones on screen
(the owner's call before sharing outside the company).
