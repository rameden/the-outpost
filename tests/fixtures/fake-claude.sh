#!/bin/sh
# Stands in for the `claude` CLI's login check in tests. FAKE_CLAUDE_LOGIN picks the answer.
case "$1" in
  --version) echo "2.1.296 (Claude Code)" ;;
  auth)
    case "$FAKE_CLAUDE_LOGIN" in
      apikey) echo '{"loggedIn":true,"authMethod":"api_key","apiKeySource":"ANTHROPIC_API_KEY","apiProvider":"firstParty"}' ;;
      out)    echo '{"loggedIn":false}' ;;
      *)      echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max"}' ;;
    esac ;;
esac
