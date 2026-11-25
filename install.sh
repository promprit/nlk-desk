#!/bin/bash
# NLK installer. Safe to run again: steps already done print "skip <step>".
set -euo pipefail

REPO=$(cd "$(dirname "$0")" && pwd)
NLK="$HOME/.nlk"
CFG="$NLK/claude"
TGDIR="$CFG/channels/telegram-nlk"
SETUP="$REPO/plugin/setup"
API=https://api.telegram.org
LABELS=(com.nlk.session com.nlk.svc com.nlk.awake)

ok() { echo "✓ $1"; }
skip() { echo "skip $1"; }
die() { echo "$1" >&2; exit 1; }
cl() { CLAUDE_CONFIG_DIR="$CFG" claude "$@"; }
ask() { local r=''; printf '%s ' "$1" >&2; IFS= read -r r || true; printf '%s' "$r"; }
yes_no() { local a; a=$(ask "$1"); [[ $a =~ ^[Yy] ]]; }
jget() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v?.[k];if(v!==undefined&&v!==null)console.log(typeof v==="object"?JSON.stringify(v):v)}catch{}})' "$1"
}

[ "$(uname)" = Darwin ] || die "NLK runs on macOS only."
need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "$1 is missing. To install it, I would run: $2"
  yes_no "Run it now? [y/N]" || die "$1 is required; install it and run ./install.sh again."
  bash -c "$2"
}
need brew "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
need node "brew install node@24"
need tmux "brew install tmux"
need bun "brew install oven-sh/bun/bun"
need claude "brew install --cask claude-code"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || die "Node 24 or newer is required (brew install node@24)."
TESTED=$(head -n1 "$REPO/TESTED_CLAUDE" 2>/dev/null | tr -d '[:space:]' || true)
HAVE=$(claude --version | awk '{print $1; exit}')
if [ -n "$TESTED" ] && [ "$HAVE" != "$TESTED" ] && [ "$(printf '%s\n%s\n' "$TESTED" "$HAVE" | sort -V | tail -n1)" = "$HAVE" ]; then
  echo "note: Claude Code $HAVE is newer than tested ($TESTED); if NLK misbehaves, send this line to whoever gave you NLK"
fi
ok prerequisites

mkdir -p "$NLK"/{claude,desk/private,files,logs,memory}
if cl auth status >/dev/null 2>&1; then
  skip login
else
  echo "A Claude window opens: type /login, sign in with your Pro account, then /exit"
  cl
  cl auth status >/dev/null 2>&1 || die "Not signed in. Run ./install.sh again."
  ok login
fi

add_market() { cl plugin marketplace list 2>/dev/null | grep -q "$2" || cl plugin marketplace add "$1" >/dev/null; }
add_plugin() {
  if cl plugin list 2>/dev/null | grep -q "$1"; then cl plugin update "$1" >/dev/null; else cl plugin install "$1" >/dev/null; fi
}
add_market anthropics/claude-plugins-official claude-plugins-official
add_plugin telegram@claude-plugins-official
add_market "$REPO" nlk
add_plugin nlk@nlk
node "$SETUP/write.ts" app >/dev/null
(cd "$NLK/app" && npm ci --omit=dev >/dev/null)
ok plugins

ENVF="$TGDIR/.env"
if [ -f "$ENVF" ]; then
  skip token
else
  TOKEN=${NLK_TOKEN:-}
  if [ -z "$TOKEN" ]; then
    printf 'Paste the BotFather token (hidden): ' >&2
    IFS= read -rs TOKEN || true
    echo >&2
  fi
  [[ $TOKEN =~ ^[0-9]{6,12}:[A-Za-z0-9_-]{30,}$ ]] || die "That does not look like a BotFather token."
  curl -s "$API/bot$TOKEN/getMe" | grep -q '"ok":true' || die "Telegram rejected the token."
  (umask 077; mkdir -p "$TGDIR"; printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TOKEN" > "$ENVF")
  chmod 600 "$ENVF"
  ok token
fi
TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$ENVF")

ACCESS="$TGDIR/access.json"
if [ -f "$ACCESS" ] && [ -n "$(jget allowFrom.0 < "$ACCESS")" ]; then
  skip pairing
else
  BOT=$(curl -s "$API/bot$TOKEN/getMe" | jget result.username)
  echo "Send any message to @$BOT now (waiting up to 5 minutes)…"
  SENDER=''
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    SENDER=$(curl -s "$API/bot$TOKEN/getUpdates?timeout=30" | node "$SETUP/pair.ts" sender)
    [ -n "$SENDER" ] && break
  done
  [ -n "$SENDER" ] || die "No message arrived. Run ./install.sh again."
  IFS=$'\t' read -r S_ID S_NAME _ S_UPDATE <<< "$SENDER"
  yes_no "Is this you? $S_NAME (id $S_ID) [y/N]" || die "Not paired: nobody was allowed. Run ./install.sh again."
  (umask 077; node "$SETUP/pair.ts" access "$S_ID" "$ACCESS" > "$ACCESS.tmp"; mv "$ACCESS.tmp" "$ACCESS")
  curl -s "$API/bot$TOKEN/getUpdates?offset=$((S_UPDATE + 1))" >/dev/null
  ok pairing
fi
OWNER_ID=$(jget allowFrom.0 < "$ACCESS")

PERSONA="$NLK/desk/private/persona.md"
if [ -f "$PERSONA" ]; then
  skip persona
else
  NAME=$(ask "What should NLK call you?")
  CITY=$(ask "Your city for weather?")
  LAT=''; LON=''; CITY_NAME=''
  if [ -n "$CITY" ]; then
    GEO=$(curl -s -G --data-urlencode "name=$CITY" --data-urlencode count=1 https://geocoding-api.open-meteo.com/v1/search)
    LAT=$(jget results.0.latitude <<< "$GEO"); LON=$(jget results.0.longitude <<< "$GEO"); CITY_NAME=$(jget results.0.name <<< "$GEO")
    [ -n "$LAT" ] || echo "Could not find that city; NLK will ask for it later."
  fi
  BRIEF=off; AT=08:30
  if yes_no "Daily morning brief? [y/N]"; then
    BRIEF=on
    AT=$(ask "At what time? (HH:MM, default 08:30)")
    [[ $AT =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || AT=08:30
  fi
  AWAKE=no
  yes_no "Keep the Mac awake while charging? [y/N]" && AWAKE=yes
  node "$SETUP/config.ts" write "$NLK/config.json" "$NAME" "$CITY_NAME" "$LAT" "$LON" "$BRIEF" "$AT" "$AWAKE" > "$NLK/config.json.tmp"
  mv "$NLK/config.json.tmp" "$NLK/config.json"
  node "$SETUP/write.ts" templates >/dev/null
  if yes_no "Open persona.md and core.md to edit now? [y/N]"; then
    open -e "$PERSONA" "$NLK/desk/private/core.md"
  fi
  ok persona
fi

node "$SETUP/write.ts" all >/dev/null
UID_=$(id -u)
STARTED=0
LOADED=0
for l in "${LABELS[@]}"; do
  p="$HOME/Library/LaunchAgents/$l.plist"
  [ -f "$p" ] || continue
  if launchctl print "gui/$UID_/$l" >/dev/null 2>&1; then LOADED=1; continue; fi
  launchctl bootstrap "gui/$UID_" "$p"
  STARTED=1
done
[ "$LOADED" = 1 ] && bash "$NLK/ctl.sh" restart >/dev/null
if [ "$STARTED" = 1 ]; then
  sleep "${NLK_WAIT_CHANNELS:-10}"
  PANE=$(tmux -L nlk capture-pane -p -t nlk 2>/dev/null || true)
  if grep -qi 'channelsEnabled: true' <<< "$PANE" && grep -qi 'managed settings' <<< "$PANE"; then
    bash "$NLK/ctl.sh" stop >/dev/null || true
    die "Telegram channels are turned off for this Claude account's organization; NLK cannot run on it."
  fi
  UP=''
  for ((i = 0; i < ${NLK_WAIT_STATUS:-60}; i += 2)); do
    [ "$(jget channels.telegram.ok < "$NLK/status.json" 2>/dev/null)" = true ] && { UP=1; break; }
    sleep 2
  done
  [ -n "$UP" ] || echo "NLK has not reported Telegram connected yet; check ./nlk status in a minute."
  curl -s -X POST "$API/bot$TOKEN/sendMessage" -d "chat_id=$OWNER_ID" --data-urlencode "text=สวัสดีค่ะ NLK พร้อมแล้วค่ะ" >/dev/null
fi
ok start

cat <<EOF

NLK is installed.
  Data, memory and logs: $NLK
  Agents: com.nlk.session, com.nlk.svc (in ~/Library/LaunchAgents)
  Watch it:  tmux -L nlk attach   (leave with Ctrl-b d)
  Control:   $REPO/nlk status|restart|stop|logs|backup
  Remove:    $REPO/uninstall.sh
NLK answers only while this Mac is awake.
EOF
