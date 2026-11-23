# Which outpost scripts/relay/relay.sh and scripts/tailscale.sh reach. Sourced, not run.
#
# OUTPOST=<name> (or the name after the command: relay.sh install Work) picks one; with neither
# it's Mae, exactly as before outposts. The outpost is found the way `npm run outpost` finds it
# (scripts/outpost.ts where): Mae is this checkout, the others are ~/Outposts/<slug>/ with their
# own camp/outpost.json.
#
# Sets:
#   OUTPOST_NAME  Mae, Work…            SLUG       mae, work…
#   CAMP_PORT     where it listens       CAMP_DIR   its folder (camp/.token is in there)
#   IS_MAE        1 for Mae, else empty  LABEL_PREFIX  app.outpostmae (Mae), app.outpostmae.<slug>
#   TS_PORT       the Tailscale Serve HTTPS port: 443 for Mae, the outpost's own port for others
#
# Each outpost but Mae gets one more address of its own on every route: <slug>.<zone> on the
# relay, https://<this-mac>.<tailnet>.ts.net:<port>/ on Tailscale.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -z "${OUTPOST:-}" ]]; then
  OUTPOST_NAME=Mae; SLUG=mae; CAMP_DIR="$REPO"; IS_MAE=1
  CAMP_PORT="${CAMP_PORT:-4747}"
else
  _kind=""
  IFS=$'\t' read -r OUTPOST_NAME SLUG CAMP_PORT CAMP_DIR _kind < <(cd "$REPO" && node --import tsx scripts/outpost.ts where "$OUTPOST") || true
  [[ -n "$_kind" ]] || exit 1   # outpost.ts has said why (no such outpost)
  IS_MAE=""; [[ "$_kind" == mae ]] && IS_MAE=1
  unset _kind
fi

if [[ -n "$IS_MAE" ]]; then LABEL_PREFIX="app.outpostmae"; TS_PORT=443
else LABEL_PREFIX="app.outpostmae.$SLUG"; TS_PORT="$CAMP_PORT"; fi
