#!/usr/bin/env bash
# Mae from your own devices, anywhere, over Tailscale.
#
#   your phone ──Tailscale (WireGuard)──▶ this Mac: Tailscale Serve (HTTPS) ──▶ Mae on 127.0.0.1:4747
#
# Mae gets no public address at all: only devices signed in to your tailnet can reach
# https://<this-mac>.<tailnet>.ts.net, and Tailscale Serve hands those requests to Mae on this
# Mac. Serve adds forwarding headers, so Mae treats them as coming from another machine (no
# terminal pane, no folder dialog), even though they arrive from 127.0.0.1.
#
# Locks: your tailnet sign-in (Google, with its 2-step verification), then Mae's own key.
#
#   scripts/tailscale.sh install    serve Mae on the tailnet and keep it running under launchd
#   scripts/tailscale.sh uninstall  stop serving it and stop the launchd job
#   scripts/tailscale.sh link       a one-time sign-in link for a phone or laptop (lasts 10 minutes)
#   scripts/tailscale.sh status     what's running, and the address to open
#
# Needs the Tailscale app, signed in, with MagicDNS and HTTPS certificates turned on for the
# tailnet (Tailscale admin console → DNS).

set -euo pipefail

CAMP_PORT="${CAMP_PORT:-4747}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/.mae-relay"
AGENTS="$HOME/Library/LaunchAgents"
LABEL="app.outpostmae.tailnet"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ts() {
  if command -v tailscale >/dev/null; then tailscale "$@"
  elif [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"
  else echo "Tailscale isn't installed: get it from https://tailscale.com/download/mac and sign in." >&2; exit 1; fi
}
# This Mac's name on the tailnet, e.g. mac.tail1234.ts.net
name() {
  ts status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(j.BackendState!=="Running"){console.error("Tailscale isn'"'"'t connected: open the app and sign in.");process.exit(1)}process.stdout.write(j.Self.DNSName.replace(/\.$/,""))})'
}

install() {
  local n; n="$(name)"
  if lsof -nP -iTCP:"$CAMP_PORT" -sTCP:LISTEN >/dev/null && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    echo "Something else is already on port $CAMP_PORT (npm run ui? the Lightsail relay's job?). Stop it first." >&2; exit 1
  fi
  mkdir -p "$DIR" "$AGENTS"
  # Mae: the built page, kept awake while on mains power, answering to its tailnet name.
  cat > "$AGENTS/$LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-is</string><string>$(command -v npm)</string><string>run</string><string>ui:serve</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$(command -v node)"):$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CAMP_PROXY_NAMES</key><string>$n</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$DIR/$LABEL.log</string>
  <key>StandardErrorPath</key><string>$DIR/$LABEL.log</string>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL.plist"
  # Tailnet only: serve, never funnel (funnel would put it on the public internet).
  # The first time, Tailscale prints a link to turn Serve on for the tailnet and waits for it.
  ts serve --bg --https=443 "http://127.0.0.1:$CAMP_PORT"
  say "Serving Mae at https://$n/ (tailnet only). Logs: $DIR/$LABEL.log"
}

uninstall() {
  ts serve --https=443 off >/dev/null 2>&1 || true
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$AGENTS/$LABEL.plist"
  say "Stopped. Back to 'npm run ui' for this Mac alone."
}

link() {
  local n token; n="$(name)"; token="$(cat "$REPO/camp/.token")"
  curl -fsS -X POST -H "x-camp-token: $token" -H "content-type: application/json" -d '{}' "http://127.0.0.1:$CAMP_PORT/api/login/link" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).link.replace(/^[^#]*/,"https://'"$n"'/"))})'
}

status() {
  local n; n="$(name)"
  printf '%-18s %s\n' "$LABEL" "$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | awk '/state =/{print $3; exit}' || echo 'not loaded')"
  printf '%-18s %s\n' "Mae on this Mac" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CAMP_PORT/")"
  printf '%-18s %s\n' "https://$n" "$(curl -s -o /dev/null -w '%{http_code}' "https://$n/")"
  ts serve status 2>&1 | sed 's/^/  /'
}

case "${1:-}" in
  install|uninstall|link|status) "$1" ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
