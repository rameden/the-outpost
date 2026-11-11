#!/usr/bin/env bash
# Index the AI guidance a repo ships so the agent loads it before generic rules.
# Usage: bash discover_repo_guidance.sh [repo_root] [target_path_being_edited]
# Read-only. Prints: instruction chain for the target, repo skills (deduped),
# agent commands/subagents, ADR index, memory notes, and the repo's check scripts.

ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
TARGET="${2:-}"
cd "$ROOT" || exit 1
PRUNE='-path ./node_modules -prune -o -path ./.git -prune -o -path ./.next -prune -o -path ./.turbo -prune -o -path ./dist -prune -o -path ./build -prune -o -path ./coverage -prune -o'

frontmatter() { # $1 file $2 key -> single-line value
  awk -v k="$2" 'NR==1&&$0!="---"{exit} NR>1&&$0=="---"{exit}
    $0 ~ "^"k":" {sub("^"k":[ ]*",""); v=$0; getline; while($0 ~ /^[ ]+/){v=v" "$0; if((getline)<=0)break}
    gsub(/^[>|-]+ */,"",v); gsub(/[ ]+/," ",v); print v; exit}' "$1"
}

echo "# Repo guidance index — $ROOT"
echo

echo "## Instruction files (repo-wide and nested)"
eval find . $PRUNE \\\( -name AGENTS.md -o -name CLAUDE.md -o -name CLAUDE.local.md -o -name copilot-instructions.md -o -name .cursorrules \\\) -type f -print \
  | grep -v '/skills/' | sort | sed 's|^\./|- |'
echo

if [ -n "$TARGET" ]; then
  echo "## Applies to $TARGET (read in this order; nearest wins on conflict)"
  d="$TARGET"; [ -f "$d" ] && d="$(dirname "$d")"
  chain=()
  while :; do
    for f in AGENTS.md CLAUDE.md; do [ -f "$d/$f" ] && chain+=("${d#./}/$f"); done
    [ "$d" = "." ] || [ "$d" = "/" ] || [ -z "$d" ] && break
    d="$(dirname "$d")"
  done
  for (( i=${#chain[@]}-1; i>=0; i-- )); do echo "- ${chain[$i]}"; done
  echo
fi

echo "## Skills — grouped by name; first path listed is the one to read"
echo "(Prefer the path the root AGENTS.md cites. 'DIFFERS' means copies drifted: read both, flag it.)"
tmp="$(mktemp)"
for base in .github .claude .agents; do
  [ -d "$base" ] || continue
  find -L "$base" -name SKILL.md -not -path '*/node_modules/*' 2>/dev/null | sort | while IFS= read -r f; do
    name="$(frontmatter "$f" name)"; [ -z "$name" ] && name="$(basename "$(dirname "$f")")"
    desc="$(frontmatter "$f" description | cut -c1-180)"
    comp=""; [ -f "$(dirname "$f")/AGENTS.md" ] && comp=" (+AGENTS.md)"
    printf '%s\t%s\t%s\t%s\t%s\n' "$name" "${f#./}$comp" "$(sha1sum "$f" | cut -c1-10)" "$(readlink -f "$f")" "$desc"
  done
done > "$tmp"
awk -F'\t' '
  { if (!($1 in first)) { order[++n]=$1; first[$1]=$2; h[$1]=$3; r[$1]=$4; d[$1]=$5 }
    else { note = ($4==r[$1]) ? "same file (symlink)" : ($3==h[$1] ? "identical copy" : "DIFFERS — check which is current");
           extra[$1] = extra[$1] "\n  - also " $2 ": " note } }
  END { for (i=1;i<=n;i++){k=order[i]; printf "- **%s** | %s | %s%s\n", k, first[k], d[k], extra[k]} }' "$tmp"
rm -f "$tmp"
echo

echo "## Commands, subagents, rules, hooks"
for d in .claude/commands .claude/agents .claude/rules .agents/commands .agents/agents .agents/rules .github/prompts .github/instructions; do
  [ -d "$d" ] && find "$d" -maxdepth 2 -type f \( -name '*.md' -o -name '*.yml' -o -name '*.yaml' \) | sort | sed 's|^|- |'
done
for s in .claude/settings.json .claude/settings.local.json; do [ -f "$s" ] && echo "- $s (hooks/permissions)"; done
echo

if [ -d docs/adrs ]; then
  echo "## ADRs (docs/adrs) — follow Accepted ones"
  for f in docs/adrs/*.md; do
    [ "$(basename "$f")" = README.md ] && continue
    st="$(grep -m1 -iE '^\**status\**:?' "$f" | sed 's/[*#]//g' | tr -s ' ')"
    echo "- $(basename "$f") — ${st:-status ?} — $(grep -m1 '^# ' "$f" | sed 's/^# //')"
  done
  echo
fi
[ -d docs/rfcs ] && { echo "## RFCs"; ls docs/rfcs | grep -v README | sed 's|^|- docs/rfcs/|'; echo; }

for m in memories/repo .memories/repo /memories/repo; do
  [ -d "$m" ] && { echo "## Repo memory notes ($m)"; ls "$m" | sed 's|^|- |'; echo; }
done

if [ -f package.json ]; then
  echo "## Package manager and check scripts"
  for lock in pnpm-lock.yaml yarn.lock package-lock.json bun.lockb bun.lock; do [ -f "$lock" ] && echo "- lockfile: $lock"; done
  node -e '
    const s = require("./package.json").scripts || {};
    for (const k of Object.keys(s)) if (/^(format|lint|typecheck|type-check|tsc|test|e2e|build|check)/.test(k)) console.log(`- ${k}: ${s[k]}`);
  ' 2>/dev/null
fi
