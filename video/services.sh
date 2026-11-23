#!/usr/bin/env bash
# Starts/stops a private SAMPLE instance of the lab for the video sample: the stand-in (video/stub.mjs, port 6990) and the lab
# (port 6991) in Real mode against it, with its own settings file, no .env, no tenant. Different ports from the lab's own (7812), so it
# never touches a running lab. Usage (from the repo root): VIDEO_STATE=/path/to/dir video/services.sh start|stop
set -euo pipefail
STATE="${VIDEO_STATE:?set VIDEO_STATE to a writable directory}"; mkdir -p "$STATE"
case "${1:-}" in
  start)
    node video/stub.mjs 6990 >"$STATE/stub.log" 2>&1 & echo $! >"$STATE/stub.pid"
    cat >"$STATE/sample.env" <<EOF
PFO_USER_NAME=sample-user
PFO_USER_PASSWORD=sample-password-not-real
PFO_OBO_ISSUER=http://127.0.0.1:6990
PFO_OBO_SIGNIN_CLIENT=sample-signin-client
PFO_OBO_SIGNIN_SECRET=sample-signin-secret
PFO_OBO_REDIRECT_URI=http://127.0.0.1:6991/callback
PFO_OBO_AGENT_CLIENT=sample-agent-client
PFO_OBO_AGENT_SECRET=sample-agent-secret
PFO_OBO_AGENT_DOOR=http://127.0.0.1:6990/agent/mcp
PFO_OBO_AGENT_TARGET=audience
PFO_OBO_AGENT_SCOPE=mcp opensearch:read
PFO_OBO_GATEWAY_DOOR=http://127.0.0.1:6990/gw/mcp
PFO_OBO_GATEWAY_TARGET=resource
PFO_OBO_GATEWAY_SCOPE=mcp whoami:read
PFO_OBO_GATEWAY_TOOL=whoami
EOF
    PORT=6991 PFO_ENV_FILE="$STATE/sample.env" node server/src/index.js >"$STATE/lab.log" 2>&1 & echo $! >"$STATE/lab.pid"
    for _ in $(seq 1 40); do curl -fs -o /dev/null http://127.0.0.1:6991/api/info && echo "sample lab up on http://127.0.0.1:6991 (stand-in on :6990)" && exit 0; sleep 0.5; done
    echo "sample lab did not come up; see $STATE/lab.log" >&2; exit 1 ;;
  stop)
    for f in lab stub; do [ -f "$STATE/$f.pid" ] && kill "$(cat "$STATE/$f.pid")" 2>/dev/null || true; rm -f "$STATE/$f.pid"; done; echo stopped ;;
  *) echo "usage: VIDEO_STATE=dir $0 start|stop" >&2; exit 2 ;;
esac
