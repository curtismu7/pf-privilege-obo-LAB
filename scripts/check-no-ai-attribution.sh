#!/bin/bash
# No AI attribution anywhere (owner rule 2026-11-07): fails when a tracked file, or any commit made on or after the rule
# date, contains an AI-attribution credit: the Claude Code "Generated with" line or a Co-Authored-By trailer.
# Older history is not rewritten, so only commits from the rule date on are checked; the tree is always checked.
# Prints counts and locations, never the matching text. Usage: scripts/check-no-ai-attribution.sh   (run from anywhere in the repo)
set -u
rule_date="2026-11-07"
# bracketed first letters so this file does not match its own pattern
pat='[G]enerated with \[?[C]laude Code|[C]o-[A]uthored-[B]y:'
cd "$(git rev-parse --show-toplevel)" || exit 1
status=0

tree=$(git grep -lIiE "$pat" -- . ':(exclude)scripts/check-no-ai-attribution.sh' 2>/dev/null || true)
tree_count=$(printf '%s' "$tree" | grep -c . || true)
echo "tracked files with an AI-attribution credit: $tree_count"
if [ "$tree_count" != "0" ]; then printf '%s\n' "$tree" | sed 's/^/  /'; status=1; fi

# Commits made on the rule date, before this check existed. main is not rewritten, so these exact commits are skipped;
# every other commit from the rule date on is still checked. Do not add to this list.
known_old=(
  916a38ce40625423d8af79376407f81f869b05c6
  5e1ca6cc80ee07b9f6c365e6bd45eaa6c04e292d
  a9c7e04fd95902da37e2468559c3c5f9bb9d2b16
  9e2541caefe34f049c0d9fe433aac14ff997dbc0
  4d49d2bb5766c730cab8ad3c2fe5b06dc187d06a
  35708386d7e5eef3c371bef06906d0445dfe8c74
)

self_coauthor='^[C]o-authored-by:[^<]*<([0-9]+\+)?curtismu7@users\.noreply\.github\.com>[[:space:]]*$'
bad=0
for h in $(git log --all --since="$rule_date" --format=%H 2>/dev/null); do
  case " ${known_old[*]} " in *" $h "*) continue ;; esac
  # A co-author trailer naming the owner's own GitHub noreply address is not an AI credit: GitHub's squash merge adds one when
  # a commit's author name differs from the profile name. A trailer naming anyone else (e.g. an AI) still fails.
  if git log -1 --format=%B "$h" | grep -viE "$self_coauthor" | grep -qiE "$pat"; then bad=$((bad+1)); echo "  commit ${h:0:7}"; fi
done
echo "commits since $rule_date with an AI-attribution credit: $bad"
[ "$bad" != "0" ] && status=1

[ "$status" != "0" ] && echo "FAIL    remove the credit (rule: never write it in a commit, PR body, issue, comment or file)"
exit $status
