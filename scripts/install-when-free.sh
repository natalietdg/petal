#!/bin/zsh
# Installs dist.noindex's Petal into /Applications as soon as no Claude is running inside Petal, then relaunches it.
# Polls every 20s for up to 6 hours; quitting Petal mid-Claude would cut that session off, so it never forces.
APP=/Applications/Petal.app
BUILD="${0:A:h}/../dist.noindex/mac-universal/Petal.app" # npm run package output

claude_in_petal() {
  local petal=$(pgrep -f "$APP/Contents/MacOS/Petal" | head -1)
  [ -z "$petal" ] && return 1
  ps -Ao pid=,ppid=,comm= | awk -v p=$petal '{pp[$1]=$2; c[$1]=$3} END {for (i in c) { x=i; while (x>1 && x in pp) { if (pp[x]==p) { print c[i]; break } x=pp[x] } } }' | grep -qi claude
}

for _ in $(seq 1 1080); do
  if ! claude_in_petal; then
    osascript -e 'tell application "Petal" to quit' 2>/dev/null
    for _ in $(seq 1 10); do pgrep -f "$APP/Contents/MacOS/Petal" >/dev/null || break; sleep 1; done
    pkill -f "$APP/Contents/MacOS/Petal" 2>/dev/null
    rm -rf "$APP" && cp -R "$BUILD" "$APP" && open -a "$APP" && echo "installed $(date +%H:%M:%S)"
    exit 0
  fi
  sleep 20
done
echo "gave up: Claude stayed running in Petal"
