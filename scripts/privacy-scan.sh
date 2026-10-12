#!/bin/zsh
# Fails when a built Petal.app's app.asar holds dev harness code or personal/employer strings.
# Usage: scripts/privacy-scan.sh <path/to/Petal.app> [label]
set -euo pipefail

APP=${1:?usage: privacy-scan.sh <Petal.app> [label]}
WHAT=${2:-$APP}
ASAR="$APP/Contents/Resources/app.asar"
[[ -f $ASAR ]] || { print -u2 "privacy-scan: no app.asar in $WHAT"; exit 1; }

# Case-insensitive. Keep in step with the scrub in src/dev and test fixtures.
BANNED=(paywatch businesslogic natalieleong /Users/ natalie.leong @paywatchglobal cats-local)
BANNED_WORDS=(kero sakura) # whole words only: "markerOffset" and "makeRow" contain "kero"

EXTRACTED=$(mktemp -d)
trap 'rm -rf "$EXTRACTED"' EXIT
npx --no-install @electron/asar extract "$ASAR" "$EXTRACTED/app"

failed=0
snapshot_chunks=("$EXTRACTED"/app/out/**/*snapshot*(N))
if (( ${#snapshot_chunks} )); then
  print -u2 "privacy-scan: $WHAT ships dev snapshot code:"
  print -u2 -l -- "${snapshot_chunks[@]#$EXTRACTED/app/}"
  failed=1
fi
report() {
  local term=$1 hits=$2
  [[ -z $hits ]] && return
  print -u2 "privacy-scan: $WHAT contains \"$term\" in:"
  print -u2 -- "${hits//$EXTRACTED\/app\//  }"
  failed=1
}
for term in "${BANNED[@]}"; do report "$term" "$(grep -rIil -F -- "$term" "$EXTRACTED/app" || true)"; done
for term in "${BANNED_WORDS[@]}"; do report "$term" "$(grep -rIilw -F -- "$term" "$EXTRACTED/app" || true)"; done
(( failed )) && exit 1
print "privacy-scan: $WHAT is clean (no snapshot chunk, none of: ${BANNED[*]} ${BANNED_WORDS[*]})"
