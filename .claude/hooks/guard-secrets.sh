#!/usr/bin/env bash
# PreToolUse hook (Bash): blocks a `git commit` whose staged changes contain
# anything shaped like a credential. This repo is public, and local dev
# shares the production database, so a leaked key is a production incident.
# Exit 2 = block the tool call and show stderr to Claude.

cmd=$(python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

diff=$(git diff --cached -U0 2>/dev/null)
# `git commit -a` stages tracked changes at commit time -- scan those too.
case "$cmd" in
  *" -a"*|*"--all"*|*" -am"*) diff="$diff
$(git diff -U0 2>/dev/null)" ;;
esac

added=$(printf '%s\n' "$diff" | grep -E '^\+[^+]')
pattern='eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|postgres(ql)?://[^:/[:space:]]+:[^@[:space:]]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----'

if printf '%s\n' "$added" | grep -Eq "$pattern"; then
  echo "BLOCKED by .claude/hooks/guard-secrets.sh: staged changes contain what looks like a credential (JWT/Supabase key, GitHub token, Postgres URL with password, or private key). Remove it, keep secrets in .env.local / Vercel env, and commit again." >&2
  exit 2
fi
exit 0
