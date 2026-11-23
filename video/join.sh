#!/usr/bin/env bash
# Joins the two segments of the live take into one video (same profile, same size): the main segment, then the end segment
# (the observability slide and the close) that was built from the log capture taken straight after the main one.
# Usage: video/join.sh <main.mp4> <end.mp4> <out.mp4>
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: $0 <main.mp4> <end.mp4> <out.mp4>" >&2; exit 2; }
for f in "$1" "$2"; do [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }; done
ffmpeg -hide_banner -loglevel error -y -i "$1" -i "$2" \
  -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p "$3"
echo "joined: $3"
