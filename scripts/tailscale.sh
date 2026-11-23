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
# This is the backup way in; the main one is the Lightsail relay (scripts/relay/relay.sh). Both
# share one launchd job for Mae, so both can be on at once.
#
#   scripts/tailscale.sh install    serve Mae on the tailnet and keep it running under launchd
#   scripts/tailscale.sh uninstall  stop serving it on the tailnet (Mae keeps running for the relay)
#   scripts/tailscale.sh link       a one-time sign-in link for a phone or laptop (lasts 10 minutes)
#   scripts/tailscale.sh status     what's running, and the address to open
#
# Needs the Tailscale app, signed in, with MagicDNS and HTTPS certificates turned on for the
# tailnet (Tailscale admin console → DNS).
#
# Other outposts: name one after the command (or OUTPOST=Work), and it's served on a port of its
# own on the same name: https://<this-mac>.<tailnet>.ts.net:4748/ for an outpost on 4748 (its
# own port, so it's easy to tell which is which). A tailnet name is per machine, so a Serve port
# is the one thing that tells outposts apart without a Tailscale service of their own. Its camp
# job is the relay's for that outpost (scripts/relay/relay.sh camp Work). Mae stays on 443.

set -euo pipefail

OUTPOST="${2:-${OUTPOST:-}}"
source "$(dirname "$0")/relay/outpost.sh"   # OUTPOST_NAME, CAMP_PORT, CAMP_DIR, IS_MAE, LABEL_PREFIX, TS_PORT
DIR="$HOME/.mae-relay"
AGENTS="$HOME/Library/LaunchAgents"
LABEL="$LABEL_PREFIX.camp"   # shared with scripts/relay/relay.sh
# Where it's served: Mae on the standard port, the others on their own.
at() { if [[ "$TS_PORT" == 443 ]]; then echo "https://$1/"; else echo "https://$1:$TS_PORT/"; fi; }

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
  # The camp itself is the relay's launchd job, which answers to the tailnet name while Tailscale is up.
  OUTPOST="$OUTPOST" "$REPO/scripts/relay/relay.sh" camp
  # Tailnet only: serve, never funnel (funnel would put it on the public internet).
  # The first time, Tailscale prints a link to turn Serve on for the tailnet and waits for it.
  ts serve --bg --https="$TS_PORT" "http://127.0.0.1:$CAMP_PORT"
  say "Serving $OUTPOST_NAME at $(at "$n") (tailnet only). Logs: $DIR/$LABEL.log"
}

uninstall() {
  ts serve --https="$TS_PORT" off >/dev/null 2>&1 || true
  local stop="scripts/relay/relay.sh uninstall"; [[ -n "$IS_MAE" ]] || stop="$stop '$OUTPOST_NAME'"
  say "No longer served on the tailnet. $OUTPOST_NAME keeps running for the relay. To stop it: $stop"
}

link() {
  local n token; n="$(name)"; token="$(cat "$CAMP_DIR/camp/.token")"
  curl -fsS -X POST -H "x-camp-token: $token" -H "content-type: application/json" -d '{}' "http://127.0.0.1:$CAMP_PORT/api/login/link" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).link.replace(/^[^#]*/,"'"$(at "$n")"'"))})'
}

status() {
  local n; n="$(name)"
  printf '%-26s %s\n' "$LABEL" "$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | awk '/state =/{print $3; exit}' || echo 'not loaded')"
  printf '%-26s %s\n' "$OUTPOST_NAME on this Mac (:$CAMP_PORT)" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CAMP_PORT/")"
  printf '%-26s %s\n' "$(at "$n")" "$(curl -s -o /dev/null -w '%{http_code}' "$(at "$n")")"
  ts serve status 2>&1 | sed 's/^/  /'
}

case "${1:-}" in
  install|uninstall|link|status) "$1" ;;
  *) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
