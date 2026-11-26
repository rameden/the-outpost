#!/usr/bin/env bash
# The public site at https://outpostmae.app, from your own AWS account: the landing page
# (docs/landing.html) at /, and the Tour (docs/index.html) at /about.
#
#   visitor ──HTTPS──▶ CloudFront (ACM certificate) ──▶ private S3 bucket (index.html, about.html, …)
#                ▲
#   Route 53: outpostmae.app and www.outpostmae.app → CloudFront (www redirects to the bare domain)
#
# Everything is one CloudFormation stack (infra/site.yaml) in us-east-1, the one region CloudFront
# takes certificates from. Only the apex and www records are touched: mae.outpostmae.app (the
# relay), outposts' subdomains and anything else in the zone are left as they are.
#
#   scripts/site.sh setup    make (or update) the stack, then put the page up; first run ~5–15 minutes
#   scripts/site.sh deploy   put the current pages up and clear CloudFront's cache
#   scripts/site.sh status   the stack, the DNS answers, and whether the page answers over HTTPS
#
# Needs the AWS CLI signed in to the account that holds the hosted zone (aws login, or
# AWS_PROFILE=… for another profile). Settings: SITE_DOMAIN (default outpostmae.app) and
# SITE_STACK (default outpostmae-site).

set -euo pipefail

DOMAIN="${SITE_DOMAIN:-outpostmae.app}"
STACK="${SITE_STACK:-outpostmae-site}"
REGION=us-east-1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT/infra/site.yaml"
DOCS="$ROOT/docs"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

signed_in() {
  aws sts get-caller-identity --query Account --output text >/dev/null 2>&1 \
    || die "The AWS CLI isn't signed in. Run: aws login   (or set AWS_PROFILE to a profile that is)"
}

zone_id() {
  local id name
  read -r id name < <(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --max-items 1 \
    --query 'HostedZones[0].[Id,Name]' --output text)
  [[ "$name" == "$DOMAIN." ]] || die "No Route 53 hosted zone for $DOMAIN in this account (found: ${name:-none})."
  echo "${id#/hostedzone/}"
}

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

stack_exists() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" >/dev/null 2>&1; }

# The stack makes the apex and www records itself, and CloudFormation won't take over a record
# that's already there. Say which ones are in the way before it starts, not 10 minutes in.
check_records_free() {
  local zone="$1" taken
  taken="$(aws route53 list-resource-record-sets --hosted-zone-id "$zone" --output text \
    --query "ResourceRecordSets[?(Name=='$DOMAIN.' || Name=='www.$DOMAIN.') && (Type=='A' || Type=='AAAA' || Type=='CNAME')].[Name,Type]")"
  if [[ -n "$taken" ]]; then
    printf '%s\n' "These records already exist and the stack needs to make them itself:" "$taken" \
      "Delete them in Route 53 (console → Hosted zones → $DOMAIN), then run this again." >&2
    exit 1
  fi
}

cmd_setup() {
  signed_in
  local zone; zone="$(zone_id)"
  say "Hosted zone for $DOMAIN: $zone"
  if ! stack_exists; then check_records_free "$zone"; fi
  say "Making the stack $STACK in $REGION (the certificate and CloudFront take a while the first time)…"
  aws cloudformation deploy --region "$REGION" --stack-name "$STACK" --template-file "$TEMPLATE" \
    --parameter-overrides "DomainName=$DOMAIN" "HostedZoneId=$zone" --no-fail-on-empty-changeset
  cmd_deploy
}

cmd_deploy() {
  signed_in
  local f; for f in landing.html index.html films/ground-to-sky.html; do [[ -f "$DOCS/$f" ]] || die "No page at $DOCS/$f"; done
  stack_exists || die "No stack $STACK yet. Run: scripts/site.sh setup"
  local bucket dist
  bucket="$(output BucketName)"; dist="$(output DistributionId)"
  out="$(mktemp -d)"; trap 'rm -rf "$out"' EXIT   # global: the trap runs after this function returns
  # The landing page is the home page; its links to the Tour go to /about.
  sed 's|href="index.html"|href="/about"|g' "$DOCS/landing.html" > "$out/index.html"
  # The Tour as it is: served by no camp, it wears the Guild pack (or the one a visitor picks) and
  # its logo goes to the top of the page, not to mission control. Its own address is /about.
  sed 's|"https://outpostmae.app/"|"https://outpostmae.app/about"|g' "$DOCS/index.html" > "$out/about.html"
  # The film the landing page plays (and links to), its favicon, the screenshots it shows, and
  # the picture a link preview shows (og:image: the mark and the name, 1200x630).
  mkdir -p "$out/films" "$out/brand" "$out/shots"
  cp "$DOCS/films/ground-to-sky.html" "$out/films/"
  cp "$DOCS/brand/favicon.svg" "$out/brand/"
  local s; for s in plan run today; do cp "$DOCS/shots/$s-dark.webp" "$DOCS/shots/$s-light.webp" "$out/shots/"; done
  [[ -f "$DOCS/og.png" ]] && cp "$DOCS/og.png" "$out/og.png"
  printf 'User-agent: *\nAllow: /\n' > "$out/robots.txt"
  say "Uploading to s3://$bucket …"
  put() { aws s3 cp "$out/$1" "s3://$bucket/$1" --region "$REGION" --content-type "$2" --cache-control "$3" --only-show-errors; }
  local html="text/html; charset=utf-8" short="public, max-age=300" long="public, max-age=86400"
  put index.html "$html" "$short"
  put about.html "$html" "$short"
  put films/ground-to-sky.html "$html" "$short"
  put brand/favicon.svg "image/svg+xml" "$long"
  for f in "$out"/shots/*.webp; do put "shots/${f##*/}" "image/webp" "$long"; done
  put robots.txt "text/plain; charset=utf-8" "$long"
  [[ -f "$out/og.png" ]] && put og.png "image/png" "$long"
  say "Clearing CloudFront's cache…"
  aws cloudfront create-invalidation --distribution-id "$dist" --paths "/*" \
    --query Invalidation.Id --output text >/dev/null
  say "Up: https://$DOMAIN/  (new edges pick it up within a minute or two)"
}

cmd_status() {
  signed_in
  if stack_exists; then
    aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
      --query 'Stacks[0].[StackName,StackStatus]' --output text
    echo "CloudFront: $(output DistributionDomain)"
  else
    echo "No stack $STACK yet."
  fi
  echo "DNS $DOMAIN: $(dig +short "$DOMAIN" A | head -3 | tr '\n' ' ')"
  echo "DNS www.$DOMAIN: $(dig +short "www.$DOMAIN" A | head -3 | tr '\n' ' ')"
  echo "https://$DOMAIN/ → $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || echo 'no answer')"
  echo "https://$DOMAIN/about → $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/about" || echo 'no answer')"
  echo "https://www.$DOMAIN/ → $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 "https://www.$DOMAIN/" || echo 'no answer')"
}

case "${1:-}" in
  setup) cmd_setup ;;
  deploy) cmd_deploy ;;
  status) cmd_status ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
