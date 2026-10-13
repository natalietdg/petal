#!/bin/zsh
# Installs dist.noindex's Petal into /Applications as soon as no Claude is running inside Petal, then relaunches it.
# Polls every 20s for up to 6 hours; quitting Petal mid-Claude would cut that session off, so it never forces.
APP=/Applications/Petal.app
BUILD="${0:A:h}/../dist.noindex/mac-universal/Petal.app" # npm run package output
STAGED="$APP.installing" # same volume as $APP, so the swap is a rename
OLD="$APP.previous"

[ -x "$BUILD/Contents/MacOS/Petal" ] || { echo "no build at $BUILD; run npm run package first"; exit 1; }

# Same process-tree walk as descendants() in src/main/claude-session.ts, kept in shell so this runs without the app.
# Matches command lines, so an npm install running under node counts too (isClaudeCli there); a helper counts as well, which only waits longer.
claude_in_petal() {
  local petal=$(pgrep -f "$APP/Contents/MacOS/Petal" | head -1)
  [ -z "$petal" ] && return 1
  ps -Ao pid=,ppid=,args= | awk -v p=$petal '{pp[$1]=$2; a=$3; for (k=4; k<=NF; k++) a=a" "$k; c[$1]=a} END {for (i in c) { x=i; while (x>1 && x in pp) { if (pp[x]==p) { print c[i]; break } x=pp[x] } } }' \
    | grep -Eq '(^|/)claude(\.exe)?( |$)|@anthropic-ai/claude-code/cli\.js'
}

# Old app moves aside, new one moves in, old one goes only after that worked; a failure puts the old one back.
swap_in() {
  rm -rf "$OLD"
  [ -e "$APP" ] && { mv "$APP" "$OLD" || return 1; }
  if mv "$STAGED" "$APP"; then
    rm -rf "$OLD"
  else
    [ -e "$OLD" ] && mv "$OLD" "$APP"
    return 1
  fi
}

# Copied before Petal is touched, so a failed copy leaves her current app running.
rm -rf "$STAGED"
cp -R "$BUILD" "$STAGED" || { rm -rf "$STAGED"; echo "copy failed; $APP left as it was"; exit 1; }

for _ in $(seq 1 1080); do
  if ! claude_in_petal; then
    osascript -e 'tell application "Petal" to quit' 2>/dev/null
    for _ in $(seq 1 10); do pgrep -f "$APP/Contents/MacOS/Petal" >/dev/null || break; sleep 1; done
    pkill -f "$APP/Contents/MacOS/Petal" 2>/dev/null
    if swap_in; then
      open -a "$APP" && echo "installed $(date +%H:%M:%S)"
      exit 0
    fi
    echo "swap failed; $APP left as it was"
    open -a "$APP" 2>/dev/null
    exit 1
  fi
  sleep 20
done
rm -rf "$STAGED"
echo "gave up: Claude stayed running in Petal"
