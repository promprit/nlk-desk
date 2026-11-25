#!/bin/bash
# Removes NLK: agents, plugins, and (when asked) ~/.nlk. Never touches ~/.claude, ~/NLK-backups or this folder.
set -euo pipefail

REPO=$(cd "$(dirname "$0")" && pwd)
NLK="$HOME/.nlk"
uid=$(id -u)

ask() { local r=''; printf '%s ' "$1" >&2; IFS= read -r r || true; printf '%s' "$r"; }

for l in com.nlk.session com.nlk.svc com.nlk.awake; do
  launchctl bootout "gui/$uid/$l" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$l.plist"
done
tmux -L nlk kill-server 2>/dev/null || true
for p in nlk@nlk telegram@claude-plugins-official; do
  CLAUDE_CONFIG_DIR="$NLK/claude" claude plugin uninstall "$p" >/dev/null 2>&1 || echo "Could not uninstall $p (already gone?)"
done
echo "✓ agents and plugins removed"

if [ -d "$NLK" ]; then
  [[ $(ask "Back up memory first? [Y/n]") =~ ^[Nn] ]] || "$REPO/nlk" backup
  if [[ $(ask "Delete ~/.nlk (memory included)? [y/N]") =~ ^[Yy] ]]; then
    rm -rf "$NLK"
    echo "✓ ~/.nlk deleted"
  else
    echo "~/.nlk kept"
  fi
fi
echo "To retire the bot fully, revoke its token in BotFather (/revoke)."
