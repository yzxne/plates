#!/usr/bin/env sh
# Blocks commits that contain likely secrets.
# Usage: scripts/check-secrets.sh          (staged files; used by the pre-commit hook)
#        scripts/check-secrets.sh --all    (every tracked file)

set -u

PATTERNS='sk-ant-[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|1//[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}'
BLOCKED_NAMES='(^|/)(\.dev\.vars.*|\.env(\..*)?|.*\.pem|.*\.key)$'
SELF='scripts/check-secrets.sh'

if [ "${1:-}" = "--all" ]; then
  FILES=$(git ls-files)
  read_file() { cat -- "$1"; }
else
  FILES=$(git diff --cached --name-only --diff-filter=ACMR)
  read_file() { git show ":$1"; }
fi

found=0
for f in $FILES; do
  [ "$f" = "$SELF" ] && continue
  case "$f" in .env.example) continue ;; esac
  if printf '%s\n' "$f" | grep -Eq "$BLOCKED_NAMES"; then
    echo "BLOCKED file name: $f"
    found=1
    continue
  fi
  hits=$(read_file "$f" 2>/dev/null | grep -EnI "$PATTERNS" | cut -c1-80)
  if [ -n "$hits" ]; then
    echo "Possible secret in $f:"
    printf '%s\n' "$hits" | sed 's/^/  line /'
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo ""
  echo "Commit blocked. Remove the secret (keep it in Cloudflare secrets / your password manager)."
  exit 1
fi
exit 0
