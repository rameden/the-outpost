#!/usr/bin/env bash
# Mae from anywhere, through a small Lightsail server of your own.
#
#   your phone ──HTTPS──▶ Lightsail (Caddy: certificate + password) ──SSH tunnel──▶ this Mac (Mae on 127.0.0.1:4747)
#
# The Mac keeps an outbound SSH connection open to the server and forwards the server's
# 127.0.0.1:4748 back to Mae. Nothing on the Mac is opened to the network, and the server's only
# open ports are 22 (SSH), 80 (certificate checks, redirects to HTTPS) and 443.
#
# Two locks: Caddy's password at the door, then Mae's own key behind it. Caddy adds
# X-Forwarded-For to everything it passes on, so Mae treats every relayed request as coming from
# another machine (no terminal pane, no folder dialog), even though the tunnel arrives from here.
#
#   scripts/relay/relay.sh create     make the server, its static IP, its firewall and the DNS record
#   scripts/relay/relay.sh server     install Caddy and the tunnel's key on the server
#   scripts/relay/relay.sh password   set the password Caddy asks for (prompts; never echoed)
#   scripts/relay/relay.sh install    run Mae and the tunnel under launchd on this Mac
#   scripts/relay/relay.sh uninstall  stop both and remove them from launchd
#   scripts/relay/relay.sh link       a one-time sign-in link for a phone or laptop (lasts 10 minutes)
#   scripts/relay/relay.sh status     what's running, and whether the page answers from outside
#
# Settings: override with environment variables. Keys and the server's address live in ~/.mae-relay.

set -euo pipefail

NAME="${RELAY_NAME:-mae-relay}"
DOMAIN="${RELAY_DOMAIN:-mae.outpostmae.app}"
ZONE="${RELAY_ZONE:-outpostmae.app}"
REGION="${RELAY_REGION:-eu-west-1}"
BUNDLE="${RELAY_BUNDLE:-nano_3_0}"           # the smallest Lightsail plan
BLUEPRINT="${RELAY_BLUEPRINT:-ubuntu_24_04}"
CAMP_PORT="${CAMP_PORT:-4747}"
RELAY_PORT="${RELAY_PORT:-4748}"             # on the server, loopback only
DIR="$HOME/.mae-relay"
ADMIN_KEY="$DIR/admin_rsa"                    # full SSH access to the server, for setup (RSA: Lightsail imports it)
TUNNEL_KEY="$DIR/tunnel_ed25519"              # can only hold open the one port forward
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LABEL_CAMP="app.outpostmae.camp"
LABEL_TUNNEL="app.outpostmae.tunnel"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ip_of() { [[ -f "$DIR/ip" ]] || { echo "No server yet: run '$0 create' first." >&2; exit 1; }; cat "$DIR/ip"; }
admin() { ssh -i "$ADMIN_KEY" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$DIR/known_hosts" "ubuntu@$(ip_of)" "$@"; }

create() {
  mkdir -p "$DIR"; chmod 700 "$DIR"
  [[ -f "$ADMIN_KEY" ]] || ssh-keygen -q -t rsa -b 4096 -N "" -C "$NAME-admin" -f "$ADMIN_KEY"
  [[ -f "$TUNNEL_KEY" ]] || ssh-keygen -q -t ed25519 -N "" -C "$NAME-tunnel" -f "$TUNNEL_KEY"

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
  say "Done. Next: $0 server"
}

server() {
  say "Waiting for SSH on $(ip_of)"
  until admin true 2>/dev/null; do sleep 5; done
  local pub; pub="$(cat "$TUNNEL_KEY.pub")"
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

# The tunnel's own account: its key may hold open the one forward and do nothing else.
id tunnel >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin tunnel
install -d -m 700 -o tunnel -g tunnel /home/tunnel/.ssh
echo 'restrict,port-forwarding,permitlisten="127.0.0.1:$RELAY_PORT",command="/bin/false" $pub' > /home/tunnel/.ssh/authorized_keys
chown tunnel:tunnel /home/tunnel/.ssh/authorized_keys; chmod 600 /home/tunnel/.ssh/authorized_keys
cat > /etc/ssh/sshd_config.d/50-mae-relay.conf <<'SSHD'
PasswordAuthentication no
ClientAliveInterval 30
ClientAliveCountMax 3
SSHD
systemctl reload ssh

# Until a password is set, the door is shut: every request gets 503.
if [[ ! -f /etc/caddy/mae-password ]]; then
  cat > /etc/caddy/Caddyfile <<'CADDY'
$DOMAIN {
	respond "Set a password first: scripts/relay/relay.sh password" 503
}
CADDY
  systemctl reload caddy || systemctl restart caddy
fi
EOF
  say "Done. Next: $0 password"
}

password() {
  local pw pw2 hash
  read -rsp "Password for $DOMAIN (user: mae): " pw; echo
  read -rsp "Again: " pw2; echo
  [[ "$pw" == "$pw2" ]] || { echo "They don't match." >&2; exit 1; }
  [[ ${#pw} -ge 12 ]] || { echo "Use at least 12 characters." >&2; exit 1; }
  hash="$(printf '%s' "$pw" | admin "caddy hash-password")"
  admin "sudo bash -s" <<EOF
set -euo pipefail
echo '$hash' > /etc/caddy/mae-password; chmod 640 /etc/caddy/mae-password; chown root:caddy /etc/caddy/mae-password
cat > /etc/caddy/Caddyfile <<'CADDY'
$DOMAIN {
	basic_auth {
		mae $hash
	}
	reverse_proxy 127.0.0.1:$RELAY_PORT {
		# Mae answers only to its own address; the tunnel hands it over on this Mac.
		header_up Host 127.0.0.1:$CAMP_PORT
		flush_interval -1
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
EOF
  say "Password set. Next: $0 install"
}

plist() { # label, then the program and its arguments
  local label="$1"; shift
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n'
  printf '  <key>Label</key><string>%s</string>\n  <key>ProgramArguments</key><array>\n' "$label"
  for a in "$@"; do printf '    <string>%s</string>\n' "$a"; done
  printf '  </array>\n  <key>WorkingDirectory</key><string>%s</string>\n' "$REPO"
  printf '  <key>EnvironmentVariables</key><dict><key>PATH</key><string>%s</string></dict>\n' "$(dirname "$(command -v node)"):$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  printf '  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ThrottleInterval</key><integer>15</integer>\n'
  printf '  <key>StandardOutPath</key><string>%s/%s.log</string>\n  <key>StandardErrorPath</key><string>%s/%s.log</string>\n' "$DIR" "$label" "$DIR" "$label"
  printf '</dict></plist>\n'
}

install() {
  mkdir -p "$AGENTS"
  # Mae: the built page, kept awake (caffeinate -s holds off sleep while on mains power).
  plist "$LABEL_CAMP" /usr/bin/caffeinate -is "$(command -v npm)" run ui:serve > "$AGENTS/$LABEL_CAMP.plist"
  # The tunnel: launchd starts it again whenever it drops (Wi-Fi gone, server rebooted…).
  plist "$LABEL_TUNNEL" /usr/bin/ssh -N -i "$TUNNEL_KEY" \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$DIR/known_hosts" -o BatchMode=yes \
    -R "127.0.0.1:$RELAY_PORT:127.0.0.1:$CAMP_PORT" "tunnel@$(ip_of)" > "$AGENTS/$LABEL_TUNNEL.plist"
  for l in "$LABEL_CAMP" "$LABEL_TUNNEL"; do
    launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$AGENTS/$l.plist"
  done
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
  local token; token="$(cat "$REPO/camp/.token")"
  curl -fsS -X POST -H "x-camp-token: $token" -H "content-type: application/json" -d '{}' "http://127.0.0.1:$CAMP_PORT/api/login/link" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s).link;console.log(l.replace(/^[^#]*/,"https://'"$DOMAIN"'/"))})'
}

status() {
  for l in "$LABEL_CAMP" "$LABEL_TUNNEL"; do
    printf '%-22s %s\n' "$l" "$(launchctl print "gui/$(id -u)/$l" 2>/dev/null | awk '/state =/{print $3; exit}' || echo 'not loaded')"
  done
  printf '%-22s %s\n' "Mae on this Mac" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$CAMP_PORT/")"
  printf '%-22s %s\n' "https://$DOMAIN" "$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/") (401 = password prompt, as it should be)"
}

case "${1:-}" in
  create|server|password|install|uninstall|link|status) "$1" ;;
  *) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
