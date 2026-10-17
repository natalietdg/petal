#!/bin/zsh
# Full snapshot run under a scratch HOME and a stand-in claude; never reads her ~/.claude or runs the real CLI.
# Usage: scripts/snapshot-full-fake-home.sh [scratch-dir]   (run before handing a branch over; exit 0 only on fail=0)
# PASTEL_SNAPSHOT_MODE=<mode> runs one mode instead of the full sequence, under the same scratch HOME.
set -u
REPO=${0:A:h:h}
SCRATCH=${1:-${TMPDIR:-/tmp}/petal-fake-home-run}
NODE_BIN=~/.nvm/versions/node/v22.23.1/bin
TIMEOUT_S=3600 # a loaded Mac (several agents running) can take most of an hour

[[ -x $NODE_BIN/node ]] && export PATH=$NODE_BIN:$PATH
cd $REPO || exit 1
npx electron-vite build >$SCRATCH.build.log 2>&1 || { echo "BUILD FAILED"; tail -20 $SCRATCH.build.log; exit 1; }

# The Electron binary itself, so the alarm reaches it (the npm wrapper outlives a signal).
ELECTRON=$(node -p "require('electron')") || { echo "NO ELECTRON BINARY"; exit 1; }
FAKE_HOME=$SCRATCH/home
SNAP=$SCRATCH/snap
rm -rf $SCRATCH; mkdir -p $FAKE_HOME/.local/bin $SNAP
: > $SNAP/fixture.jsonl # the harness writes its own fixture; the file only has to exist

# Stand-in claude at the native installer's spot: a version for the onboarding checks, nothing else.
cat > $FAKE_HOME/.local/bin/claude <<'EOF'
#!/bin/sh
case "$1" in
  --version|-v) echo "2.1.0 (Claude Code, snapshot stand-in)" ;;
  *) echo "snapshot stand-in claude: refusing to run '$*'" >&2; exit 1 ;;
esac
EOF
chmod +x $FAKE_HOME/.local/bin/claude

# A fixed environment: no inherited Claude folder, rc files or her PATH entries.
env -i \
  HOME=$FAKE_HOME USER=${USER} LOGNAME=${USER} SHELL=/bin/zsh TERM=xterm-256color LANG=en_US.UTF-8 TMPDIR=${TMPDIR:-/tmp} \
  PATH=$FAKE_HOME/.local/bin:$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin \
  PASTEL_SNAPSHOT=1 ${PASTEL_SNAPSHOT_MODE:+PASTEL_SNAPSHOT_MODE=$PASTEL_SNAPSHOT_MODE} PASTEL_SNAPSHOT_FAKE_JSONL=$SNAP/fixture.jsonl PASTEL_SNAPSHOT_DIR=$SNAP \
  perl -e "alarm $TIMEOUT_S; exec @ARGV" $ELECTRON . >$SNAP/stdout.log 2>&1

line=$(grep -E '^SNAPSHOT (COMPLETE|INCOMPLETE)' $SNAP/snapshot.log 2>/dev/null | tail -1)
echo "${line:-SNAPSHOT NO COMPLETE LINE (timed out or crashed; see $SNAP/stdout.log)}"
grep -E '^FAIL' $SNAP/snapshot.log 2>/dev/null | cut -c1-400
echo "log: $SNAP/snapshot.log"
echo "$line" | awk '/^SNAPSHOT COMPLETE/ { split($0, a, "fail="); split(a[2], f, " "); n = split($0, b, "steps="); split(b[2], s, "/");
  if (f[1] == 0 && (n < 2 || s[1] == s[2] + 0)) ok = 1 } END { exit ok ? 0 : 1 }'
