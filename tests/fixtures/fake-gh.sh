#!/bin/sh
# Stands in for the GitHub CLI's account commands in tests. The active account is kept in
# $FAKE_GH_STATE; the signed-in accounts are $FAKE_GH_ACCOUNTS (space-separated).
active=$(cat "$FAKE_GH_STATE" 2>/dev/null || echo "${FAKE_GH_ACCOUNTS%% *}")
if [ "$1 $2" = "auth status" ]; then
  printf '{"hosts":{"github.com":['
  sep=""
  for a in $FAKE_GH_ACCOUNTS; do
    [ "$a" = "$active" ] && on=true || on=false
    printf '%s{"login":"%s","active":%s,"state":"success","host":"github.com"}' "$sep" "$a" "$on"
    sep=","
  done
  printf ']}}\n'
  exit 0
fi
if [ "$1 $2" = "auth switch" ]; then
  shift 2
  while [ $# -gt 0 ]; do
    case "$1" in --user) user="$2"; shift ;; esac
    shift
  done
  echo "$user" > "$FAKE_GH_STATE"
  echo "✓ Switched active account for github.com to $user" >&2
  exit 0
fi
echo "unexpected: $*" >&2; exit 2
