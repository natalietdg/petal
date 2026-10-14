#!/bin/zsh
# Fails when a built Petal.app holds dev harness code or personal/employer strings,
# in app.asar or in the text files beside it in Contents/Resources (*.md, *.yml, *.json).
# Usage: scripts/privacy-scan.sh <path/to/Petal.app> [label]
set -euo pipefail

APP=${1:?usage: privacy-scan.sh <Petal.app> [label]}
WHAT=${2:-$APP}
RESOURCES="$APP/Contents/Resources"
ASAR="$RESOURCES/app.asar"
[[ -f $ASAR ]] || { print -u2 "privacy-scan: no app.asar in $WHAT"; exit 1; }

# Case-insensitive. Keep in step with the scrub in src/dev and test fixtures.
BANNED=(paywatch businesslogic natalieleong /Users/ natalie.leong @paywatchglobal cats-local)
BANNED_WORDS=(kero sakura natalie) # whole words only: "markerOffset" and "makeRow" contain "kero"
# Allowed on purpose: the update feed host (app-update.yml, electron-builder.yml). Removed from the copies before matching.
ALLOWED=(natalieleong19.workers.dev)

EXTRACTED=$(mktemp -d)
trap 'rm -rf "$EXTRACTED"' EXIT
npx --no-install @electron/asar extract "$ASAR" "$EXTRACTED/app"
# Resources text files, copied beside the extracted asar under resources/ so hits name their place.
( cd "$RESOURCES" && find . -path ./app.asar -prune -o -type f \( -name '*.md' -o -name '*.yml' -o -name '*.json' \) -print ) | while IFS= read -r file; do
  mkdir -p "$EXTRACTED/resources/${file:h}"
  cp "$RESOURCES/$file" "$EXTRACTED/resources/$file"
done
for allowed in "${ALLOWED[@]}"; do
  { grep -rIl -F -i -- "$allowed" "$EXTRACTED" || true; } | while IFS= read -r file; do
    ALLOWED_TERM=$allowed perl -pi -e 's/\Q$ENV{ALLOWED_TERM}\E//gi' "$file"
  done
done

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
  print -u2 -- "${hits//$EXTRACTED\//  }"
  failed=1
}
for term in "${BANNED[@]}"; do report "$term" "$(grep -rIil -F -- "$term" "$EXTRACTED" || true)"; done
for term in "${BANNED_WORDS[@]}"; do report "$term" "$(grep -rIilw -F -- "$term" "$EXTRACTED" || true)"; done
(( failed )) && exit 1
print "privacy-scan: $WHAT is clean (no snapshot chunk, none of: ${BANNED[*]} ${BANNED_WORDS[*]}; allowed: ${ALLOWED[*]})"
