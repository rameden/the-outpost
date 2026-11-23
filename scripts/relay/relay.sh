#!/usr/bin/env bash
# Mae from anywhere, through a small Lightsail server of your own.
#
#   your phone ──HTTPS──▶ Lightsail (Caddy + Google sign-in) ──SSH tunnel──▶ this Mac (Mae on 127.0.0.1:4747)
#
# The Mac keeps an outbound SSH connection open to the server and forwards the server's
# 127.0.0.1:4748 back to Mae. Nothing on the Mac is opened to the network, and the server's only
# open ports are 22 (SSH), 80 (certificate checks, redirects to HTTPS) and 443.
#
# Two locks: your Google account at the door (oauth2-proxy lets in only the addresses you list,
# or Caddy's password instead), then Mae's own key behind it. Caddy adds
# X-Forwarded-For to everything it passes on, so Mae treats every relayed request as coming from
# another machine (no terminal pane, no folder dialog), even though the tunnel arrives from here.
#
#   scripts/relay/relay.sh create     make the server, its static IP, its firewall and the DNS record
#   scripts/relay/relay.sh server     install Caddy and the tunnel's key on the server
#   scripts/relay/relay.sh google     sign in with Google at the door (prompts for the OAuth client)
#   scripts/relay/relay.sh password   or: a password at the door instead (prompts; never echoed)
#   scripts/relay/relay.sh install    run Mae and the tunnel under launchd on this Mac
#   scripts/relay/relay.sh camp       (re)start just Mae under launchd (scripts/tailscale.sh uses it)
#   scripts/relay/relay.sh uninstall  stop both and remove them from launchd
#   scripts/relay/relay.sh link       a one-time sign-in link for a phone or laptop (lasts 10 minutes)
#   scripts/relay/relay.sh status     what's running, and whether the page answers from outside
#
# Settings: override with environment variables. Keys and the server's address live in ~/.mae-relay.
#
# Tailscale is the backup way in (scripts/tailscale.sh): the same Mae job answers to its tailnet
# name too whenever Tailscale is connected, so both routes work at once.
#
# Other outposts: name one after the command (or OUTPOST=Work) and every command works on it
# instead of Mae, on the same server: scripts/relay/relay.sh create Work, then server, google
# and install the same way. Each gets its own address (work.outpostmae.app: a subdomain, so the
# page's own paths need nothing new), its own tunnel key, server-side port (its port + 1000) and
# launchd jobs (app.outpostmae.work.camp, …tunnel), and its own Caddy site in
# /etc/caddy/sites/. Google sign-in is shared: set it up for Mae first; the outpost's door then
# sends you through Mae's address to sign in once for all of them, with the same allowed list.
# Its camp job runs `npm run outpost -- start Work` from this checkout. Mae, with no name given,
# is set up exactly as before.

set -euo pipefail

OUTPOST="${2:-${OUTPOST:-}}"
source "$(dirname "$0")/outpost.sh"   # OUTPOST_NAME, SLUG, CAMP_PORT, CAMP_DIR, IS_MAE, LABEL_PREFIX, TS_PORT

NAME="${RELAY_NAME:-mae-relay}"
ZONE="${RELAY_ZONE:-outpostmae.app}"
REGION="${RELAY_REGION:-eu-west-1}"
BUNDLE="${RELAY_BUNDLE:-nano_3_0}"           # the smallest Lightsail plan
BLUEPRINT="${RELAY_BLUEPRINT:-ubuntu_24_04}"
DIR="$HOME/.mae-relay"
ADMIN_KEY="$DIR/admin_rsa"                    # full SSH access to the server, for setup (RSA: Lightsail imports it)
if [[ -n "$IS_MAE" ]]; then
  DOMAIN="${RELAY_DOMAIN:-mae.outpostmae.app}"
  RELAY_PORT="${RELAY_PORT:-4748}"           # on the server, loopback only
  TUNNEL_KEY="$DIR/tunnel_ed25519"            # can only hold open the one port forward
  DOOR_USER=mae; FOR=""
else
  DOMAIN="${RELAY_DOMAIN:-$SLUG.$ZONE}"
  RELAY_PORT="$((CAMP_PORT + 1000))"          # on the server, one per outpost (Mae's is 4748)
  TUNNEL_KEY="$DIR/tunnel-${SLUG}_ed25519"
  DOOR_USER="$SLUG"; FOR=" '$OUTPOST_NAME'"   # for the "Next:" hints
fi
AGENTS="$HOME/Library/LaunchAgents"
LABEL_CAMP="$LABEL_PREFIX.camp"
OAUTH2_PROXY_VERSION="${OAUTH2_PROXY_VERSION:-v7.15.6}"
LABEL_TUNNEL="$LABEL_PREFIX.tunnel"
SITES=/etc/caddy/sites                        # one Caddy site per outpost but Mae, imported by the Caddyfile

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ip_of() { [[ -f "$DIR/ip" ]] || { echo "No server yet: run '$0 create' first." >&2; exit 1; }; cat "$DIR/ip"; }
admin() { ssh -i "$ADMIN_KEY" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$DIR/known_hosts" "ubuntu@$(ip_of)" "$@"; }

create() {
  mkdir -p "$DIR"; chmod 700 "$DIR"
  [[ -f "$ADMIN_KEY" ]] || ssh-keygen -q -t rsa -b 4096 -N "" -C "$NAME-admin" -f "$ADMIN_KEY"
  [[ -f "$TUNNEL_KEY" ]] || ssh-keygen -q -t ed25519 -N "" -C "$NAME-$([[ -n "$IS_MAE" ]] || printf '%s-' "$SLUG")tunnel" -f "$TUNNEL_KEY"

  if ! aws lightsail get-key-pair --region "$REGION" --key-pair-name "$NAME-key" >/dev/null 2>&1; then
    say "Uploading the admin key to Lightsail"
    aws lightsail import-key-pair --region "$REGION" --key-pair-name "$NAME-key" --public-key-base64 "$(cat "$ADMIN_KEY.pub")" >/dev/null
  fi
  if ! aws lightsail get-instance --region "$REGION" --instance-name "$NAME" >/dev/null 2>&1; then
    say "Creating the server ($BUNDLE, $BLUEPRINT, $REGION)"
    local zone_az; zone_az="$(aws lightsail get-regions --include-availability-zones --query "regions[?name=='$REGION'].availabilityZones[0].zoneName" --output text)"
    aws lightsail create-instances --region "$REGION" --instance-names "$NAME" --availability-zone "$zone_az" \
      --blueprint-id "$BLUEPRINT" --bundle-id "$BUNDLE" --key-pair-name "$NAME-key" >/dev/null
  fi
  say "Waiting for it to start"
  until [[ "$(aws lightsail get-instance-state --region "$REGION" --instance-name "$NAME" --query state.name --output text)" == running ]]; do sleep 5; done

  if ! aws lightsail get-static-ip --region "$REGION" --static-ip-name "$NAME-ip" >/dev/null 2>&1; then
    say "Giving it a static IP"
    aws lightsail allocate-static-ip --region "$REGION" --static-ip-name "$NAME-ip" >/dev/null
    aws lightsail attach-static-ip --region "$REGION" --static-ip-name "$NAME-ip" --instance-name "$NAME" >/dev/null
  fi
  aws lightsail get-static-ip --region "$REGION" --static-ip-name "$NAME-ip" --query staticIp.ipAddress --output text > "$DIR/ip"

  say "Firewall: 22, 80, 443"
  aws lightsail put-instance-public-ports --region "$REGION" --instance-name "$NAME" --port-infos \
    fromPort=22,toPort=22,protocol=tcp fromPort=80,toPort=80,protocol=tcp fromPort=443,toPort=443,protocol=tcp >/dev/null

  say "DNS: $DOMAIN → $(ip_of)"
  local zone_id; zone_id="$(aws route53 list-hosted-zones-by-name --dns-name "$ZONE" --max-items 1 --query 'HostedZones[0].Id' --output text)"
  aws route53 change-resource-record-sets --hosted-zone-id "$zone_id" --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$DOMAIN\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$(ip_of)\"}]}}]}" >/dev/null
  say "Done. Next: $0 server$FOR"
}

server() {
  say "Waiting for SSH on $(ip_of)"
  until admin true 2>/dev/null; do sleep 5; done
  local pub key; pub="$(cat "$TUNNEL_KEY.pub")"; key="$(awk '{print $2}' "$TUNNEL_KEY.pub")"
  admin "sudo bash -s" <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v caddy >/dev/null; then
  apt-get update -q
  apt-get install -yq debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi
apt-get install -yq unattended-upgrades >/dev/null

# The tunnel's own account: each outpost's key may hold open its one forward and do nothing else.
# This outpost's line is replaced; the other outposts' lines are kept.
id tunnel >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin tunnel
install -d -m 700 -o tunnel -g tunnel /home/tunnel/.ssh
f=/home/tunnel/.ssh/authorized_keys; touch "\$f"
{ grep -vF "$key" "\$f" || true; echo 'restrict,port-forwarding,permitlisten="127.0.0.1:$RELAY_PORT",command="/bin/false" $pub'; } > "\$f.new"
mv "\$f.new" "\$f"
chown tunnel:tunnel "\$f"; chmod 600 "\$f"
cat > /etc/ssh/sshd_config.d/50-mae-relay.conf <<'SSHD'
PasswordAuthentication no
ClientAliveInterval 30
ClientAliveCountMax 3
SSHD
systemctl reload ssh

# Until a door is set, it's shut: every request gets 503.
if [[ "$IS_MAE" == 1 && ! -f /etc/caddy/mae-password ]]; then
  cat > /etc/caddy/Caddyfile <<'CADDY'
$DOMAIN {
	respond "Set a password first: scripts/relay/relay.sh password" 503
}
CADDY
fi
# The other outposts' sites, each in a file of its own.
mkdir -p $SITES
grep -q '^import $SITES/' /etc/caddy/Caddyfile || printf '\nimport $SITES/*.caddy\n' >> /etc/caddy/Caddyfile
if [[ "$IS_MAE" != 1 && ! -f $SITES/$SLUG.caddy ]]; then
  cat > $SITES/$SLUG.caddy <<'CADDY'
$DOMAIN {
	respond "Set a door first: scripts/relay/relay.sh google$FOR" 503
}
CADDY
fi
systemctl reload caddy || systemctl restart caddy
EOF
  if [[ -n "$IS_MAE" ]]; then say "Done. Next: $0 password (or $0 google)"
  else say "Done. Next: $0 google$FOR (or $0 password$FOR)"; fi
}

# The part of the site that hands requests to Mae, the same whichever door is in front.
to_mae() {
  cat <<EOF
		reverse_proxy 127.0.0.1:$RELAY_PORT {
			# Mae answers only to its own address; the tunnel hands it over on this Mac.
			header_up Host 127.0.0.1:$CAMP_PORT
			flush_interval -1
		}
EOF
}
site_headers() {
  printf '\theader {\n\t\tStrict-Transport-Security "max-age=31536000"\n\t\t-Server\n\t}\n'
}
# Write Mae's Caddyfile on the server (from stdin), with the other outposts' sites imported after
# it, check it, and reload.
put_caddyfile() {
  { cat; printf '\nimport %s/*.caddy\n' "$SITES"; } \
    | admin "sudo bash -c 'mkdir -p $SITES && cat > /etc/caddy/Caddyfile.new && caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null 2>&1 && mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile && systemctl reload caddy'"
}
# Write this outpost's site (from stdin) into $SITES, check the whole config with it, and reload;
# if Caddy refuses it, put back what was there.
put_site() {
  admin "sudo bash -s" <<EOF
set -euo pipefail
mkdir -p $SITES
grep -q '^import $SITES/' /etc/caddy/Caddyfile || printf '\nimport $SITES/*.caddy\n' >> /etc/caddy/Caddyfile
EOF
  admin "sudo bash -c 'f=$SITES/$SLUG.caddy; [[ -f \$f ]] && cp \$f \$f.old; cat > \$f; if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then rm -f \$f.old; systemctl reload caddy; else echo \"Caddy refused the new site.\" >&2; if [[ -f \$f.old ]]; then mv \$f.old \$f; else rm -f \$f; fi; exit 1; fi'"
}
# Mae's Caddyfile, or this outpost's site.
put_door() { if [[ -n "$IS_MAE" ]]; then put_caddyfile; else put_site; fi; }

# The site with Google sign-in at the door: Caddy asks oauth2-proxy about every request; without a
# session it sends you to Google.
google_site() {
  cat <<EOF
$DOMAIN {
	handle /oauth2/* {
		reverse_proxy 127.0.0.1:4180 {
			header_up X-Real-IP {remote_host}
			header_up X-Forwarded-Uri {uri}
		}
	}
	handle {
		forward_auth 127.0.0.1:4180 {
			uri /oauth2/auth
			header_up X-Real-IP {remote_host}
			@out status 401
			handle_response @out {
				redir * /oauth2/start?rd={scheme}://{host}{uri}
			}
		}
EOF
  to_mae
  printf '\t}\n'
  site_headers
  printf '}\n'
}

# Another outpost behind the Google sign-in Mae already has: oauth2-proxy's cookie is made to cover
# every name under the zone, and it may send you back to any of them after signing in. Google
# still returns to Mae's address, so the Google client needs nothing new.
google_outpost() {
  admin "systemctl is-active --quiet oauth2-proxy" || { echo "Google sign-in isn't on for Mae yet: run '$0 google' first." >&2; exit 1; }
  admin "sudo bash -s" <<EOF
set -euo pipefail
f=/etc/oauth2-proxy/oauth2-proxy.cfg
grep -q '^cookie_domains' "\$f" || echo 'cookie_domains = [".$ZONE"]' >> "\$f"
grep -q '^whitelist_domains' "\$f" || echo 'whitelist_domains = [".$ZONE"]' >> "\$f"
systemctl restart oauth2-proxy
EOF
  google_site | put_site
  say "Google sign-in is on at https://$DOMAIN (the same Google addresses as Mae). Next (if not yet): $0 install$FOR"
}

google() {
  [[ -n "$IS_MAE" ]] || { google_outpost; return; }
  local id secret emails cookie
  cat <<EOF
In Google Cloud Console (https://console.cloud.google.com/apis/credentials):
  OAuth consent screen: External, in Testing, with your Google address as a test user.
  Create credentials → OAuth client ID → Web application, with
    Authorized redirect URI: https://$DOMAIN/oauth2/callback
EOF
  read -rp "Client ID: " id
  read -rsp "Client secret (not shown): " secret; echo
  read -rp "Google addresses allowed in (comma-separated): " emails
  [[ "$id" == *.apps.googleusercontent.com ]] || { echo "That doesn't look like a Google client ID (…apps.googleusercontent.com)." >&2; exit 1; }
  [[ -n "$secret" && "$emails" == *@* ]] || { echo "Need the secret and at least one address." >&2; exit 1; }
  cookie="$(openssl rand -base64 32 | tr -- '+/' '-_')"

  say "Installing oauth2-proxy $OAUTH2_PROXY_VERSION on the server"
  admin "sudo bash -s" <<EOF
set -euo pipefail
if [[ "\$(/usr/local/bin/oauth2-proxy --version 2>/dev/null | awk '{print \$2}')" != "$OAUTH2_PROXY_VERSION" ]]; then
  t=\$(mktemp -d); cd "\$t"
  f=oauth2-proxy-$OAUTH2_PROXY_VERSION.linux-amd64.tar.gz
  curl -fsSLO "https://github.com/oauth2-proxy/oauth2-proxy/releases/download/$OAUTH2_PROXY_VERSION/\$f"
  curl -fsSLO "https://github.com/oauth2-proxy/oauth2-proxy/releases/download/$OAUTH2_PROXY_VERSION/\$f-sha256sum.txt"
  sha256sum -c "\$f-sha256sum.txt"
  tar xzf "\$f" && install -m 755 oauth2-proxy-$OAUTH2_PROXY_VERSION.linux-amd64/oauth2-proxy /usr/local/bin/oauth2-proxy
  cd / && rm -rf "\$t"
fi
id oauth2-proxy >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin oauth2-proxy
install -d -m 750 -o root -g oauth2-proxy /etc/oauth2-proxy
cat > /etc/systemd/system/oauth2-proxy.service <<'UNIT'
[Unit]
Description=oauth2-proxy (Google sign-in for Mae)
After=network-online.target
[Service]
User=oauth2-proxy
ExecStart=/usr/local/bin/oauth2-proxy --config=/etc/oauth2-proxy/oauth2-proxy.cfg
Restart=always
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
EOF

  # The secrets travel on stdin, never on a command line.
  { cat <<EOF
http_address = "127.0.0.1:4180"
reverse_proxy = true
provider = "google"
client_id = "$id"
client_secret = "$secret"
cookie_secret = "$cookie"
cookie_secure = true
cookie_samesite = "lax"
cookie_expire = "168h"
redirect_url = "https://$DOMAIN/oauth2/callback"
cookie_domains = [".$ZONE"]
whitelist_domains = [".$ZONE"]
authenticated_emails_file = "/etc/oauth2-proxy/emails"
upstreams = ["static://202"]
skip_provider_button = true
EOF
  } | admin "sudo bash -c 'umask 027; cat > /etc/oauth2-proxy/oauth2-proxy.cfg; chgrp oauth2-proxy /etc/oauth2-proxy/oauth2-proxy.cfg'"
  tr ',' '\n' <<<"$emails" | sed 's/^ *//; s/ *$//' | grep @ | tr 'A-Z' 'a-z' \
    | admin "sudo bash -c 'umask 027; cat > /etc/oauth2-proxy/emails; chgrp oauth2-proxy /etc/oauth2-proxy/emails'"
  admin "sudo systemctl enable --now oauth2-proxy >/dev/null 2>&1; sudo systemctl restart oauth2-proxy; sleep 2; systemctl is-active oauth2-proxy"

  google_site | put_caddyfile
  say "Google sign-in is on at https://$DOMAIN. Next (if not yet): $0 install"
}

password() {
  local pw pw2 hash
  read -rsp "Password for $DOMAIN (user: $DOOR_USER): " pw; echo
  read -rsp "Again: " pw2; echo
  [[ "$pw" == "$pw2" ]] || { echo "They don't match." >&2; exit 1; }
  [[ ${#pw} -ge 12 ]] || { echo "Use at least 12 characters." >&2; exit 1; }
  hash="$(printf '%s' "$pw" | admin "caddy hash-password")"
  # Mae's password replaces the Google sign-in; another outpost's leaves it on for the rest.
  [[ -n "$IS_MAE" ]] && admin "sudo systemctl disable --now oauth2-proxy >/dev/null 2>&1 || true"
  { printf '%s {\n\tbasic_auth {\n\t\t%s %s\n\t}\n' "$DOMAIN" "$DOOR_USER" "$hash"; to_mae; site_headers; printf '}\n'; } | put_door
  [[ -n "$IS_MAE" ]] && admin "sudo touch /etc/caddy/mae-password"
  say "Password set. Next: $0 install$FOR"
}

plist() { # label, then the program and its arguments
  local label="$1"; shift
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n'
  printf '  <key>Label</key><string>%s</string>\n  <key>ProgramArguments</key><array>\n' "$label"
  for a in "$@"; do printf '    <string>%s</string>\n' "$a"; done
  printf '  </array>\n  <key>WorkingDirectory</key><string>%s</string>\n' "$REPO"
  printf '  <key>EnvironmentVariables</key><dict>\n    <key>PATH</key><string>%s</string>\n' "$(dirname "$(command -v node)"):$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  [[ -n "${CAMP_PROXY_NAMES:-}" ]] && printf '    <key>CAMP_PROXY_NAMES</key><string>%s</string>\n' "$CAMP_PROXY_NAMES"
  # So `npm run outpost -- start` finds the outpost where this shell does.
  [[ -z "$IS_MAE" && -n "${OUTPOSTS_DIR:-}" ]] && printf '    <key>OUTPOSTS_DIR</key><string>%s</string>\n' "$OUTPOSTS_DIR"
  printf '  </dict>\n'
  printf '  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>15</integer>\n'
  printf '  <key>StandardOutPath</key><string>%s/%s.log</string>\n  <key>StandardErrorPath</key><string>%s/%s.log</string>\n' "$DIR" "$label" "$DIR" "$label"
  printf '</dict></plist>\n'
}

# This Mac's tailnet name, when Tailscale is installed and connected (else nothing).
tailnet_name() {
  local t; t="$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)"
  [[ -x "$t" ]] || return 0
  "$t" status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.BackendState==="Running")process.stdout.write(j.Self.DNSName.replace(/\.$/,""))}catch{}})' || true
}

camp() {
  mkdir -p "$DIR" "$AGENTS"
  if [[ -n "$IS_MAE" ]]; then
    launchctl bootout "gui/$(id -u)/app.outpostmae.tailnet" 2>/dev/null || true   # the old Tailscale-only job
    rm -f "$AGENTS/app.outpostmae.tailnet.plist"
  fi
  if lsof -nP -iTCP:"$CAMP_PORT" -sTCP:LISTEN >/dev/null && ! launchctl print "gui/$(id -u)/$LABEL_CAMP" >/dev/null 2>&1; then
    sleep 3
    lsof -nP -iTCP:"$CAMP_PORT" -sTCP:LISTEN >/dev/null && { echo "Something else is on port $CAMP_PORT ($([[ -n "$IS_MAE" ]] && echo "npm run ui" || echo "npm run outpost -- start $OUTPOST_NAME")?). Stop it first." >&2; exit 1; }
  fi
  # The built page, kept awake (caffeinate -s holds off sleep while on mains power), and
  # answering to its tailnet name too when Tailscale is up (with its own Serve port, but Mae).
  local names; names="$(tailnet_name)"
  [[ -n "$names" && -z "$IS_MAE" ]] && names="$names:$TS_PORT"
  if [[ -n "$IS_MAE" ]]; then
    CAMP_PROXY_NAMES="$names" plist "$LABEL_CAMP" /usr/bin/caffeinate -is "$(command -v npm)" run ui:serve > "$AGENTS/$LABEL_CAMP.plist"
  else
    CAMP_PROXY_NAMES="$names" plist "$LABEL_CAMP" /usr/bin/caffeinate -is "$(command -v npm)" run outpost -- start "$OUTPOST_NAME" > "$AGENTS/$LABEL_CAMP.plist"
  fi
  launchctl bootout "gui/$(id -u)/$LABEL_CAMP" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL_CAMP.plist"
}

install() {
  camp
  # The tunnel: launchd starts it again whenever it drops (Wi-Fi gone, server rebooted…).
  plist "$LABEL_TUNNEL" /usr/bin/ssh -N -i "$TUNNEL_KEY" \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DIR/known_hosts" -o BatchMode=yes \
    -R "127.0.0.1:$RELAY_PORT:127.0.0.1:$CAMP_PORT" "tunnel@$(ip_of)" > "$AGENTS/$LABEL_TUNNEL.plist"
  launchctl bootout "gui/$(id -u)/$LABEL_TUNNEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL_TUNNEL.plist"
  say "Running. Logs: $DIR/*.log"
}

uninstall() {
  for l in "$LABEL_CAMP" "$LABEL_TUNNEL"; do
    launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
    rm -f "$AGENTS/$l.plist"
  done
  say "Stopped. (The server is still there; delete it in Lightsail when you're done with it.)"
}

link() {
  local token; token="$(cat "$CAMP_DIR/camp/.token")"
  curl -fsS -X POST -H "x-camp-token: $token" -H "content-type: application/json" -d '{}' "http://127.0.0.1:$CAMP_PORT/api/login/link" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s).link;console.log(l.replace(/^[^#]*/,"https://'"$DOMAIN"'/"))})'
}

status() {
  for l in "$LABEL_CAMP" "$LABEL_TUNNEL"; do
    printf '%-28s %s\n' "$l" "$(launchctl print "gui/$(id -u)/$l" 2>/dev/null | awk '/state =/{print $3; exit}' || echo 'not loaded')"
  done
  printf '%-28s %s\n' "$OUTPOST_NAME on this Mac (:$CAMP_PORT)" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CAMP_PORT/")"
  printf '%-28s %s\n' "https://$DOMAIN" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "https://$DOMAIN/" | cut -c1-60) (302 to /oauth2 = Google sign-in; 401 = password)"
}

case "${1:-}" in
  create|server|google|password|install|camp|uninstall|link|status) "$1" ;;
  *) sed -n '2,39p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
