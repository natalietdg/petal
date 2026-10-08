#!/bin/zsh
# Signed, notarised, stapled universal Petal. Publishes a DRAFT GitHub release only with --publish.
# Usage: CSC_NAME="Developer ID Application: Name (DC4T539CW7)" scripts/release.sh [--check] [--publish]
set -euo pipefail
cd "${0:A:h}/.."

PROFILE=petal # xcrun notarytool store-credentials petal ...
TEAM=DC4T539CW7
OUT=dist.noindex
CHECK_ONLY=0
PUBLISH=0
for arg in "$@"; do
  case $arg in
    --check) CHECK_ONLY=1 ;;
    --publish) PUBLISH=1 ;;
    *) print -u2 "release: unknown option $arg (use --check or --publish)"; exit 2 ;;
  esac
done

problems=()
problem() { problems+=("$1"); }

# Preflight: every missing piece is listed at once, then nothing is built.
print "release: preflight"
PREFIX="Developer ID Application: "
if [[ -z ${CSC_NAME:-} ]]; then
  problem "CSC_NAME is not set. Export your Developer ID identity: CSC_NAME=\"${PREFIX}Natalie Leong ($TEAM)\""
elif [[ $CSC_NAME != "$PREFIX"* ]]; then
  problem "CSC_NAME is \"$CSC_NAME\". A release needs a \"Developer ID Application\" identity; Apple Development can't be notarised."
elif [[ $CSC_NAME != *"($TEAM)" ]]; then
  problem "CSC_NAME \"$CSC_NAME\" is not team $TEAM."
elif ! security find-identity -v -p codesigning | grep -qF "\"$CSC_NAME\""; then
  problem "No valid \"$CSC_NAME\" in the keychain. Install the Developer ID Application certificate first."
fi
if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  problem "No working notarytool keychain profile \"$PROFILE\". Create it: xcrun notarytool store-credentials $PROFILE --apple-id <apple-id> --team-id $TEAM"
fi
VERSION=$(node -p "require('./package.json').version")
grep -q "^## \[$VERSION\]" CHANGELOG.md 2>/dev/null || problem "CHANGELOG.md has no \"## [$VERSION]\" entry."
if (( PUBLISH )) && [[ -z ${GH_TOKEN:-} ]]; then
  problem "--publish needs GH_TOKEN (a token that can create releases on natalietdg/petal)."
fi
if (( ${#problems} )); then
  print -u2 "release: preflight failed, nothing was built:"
  for p in "${problems[@]}"; do print -u2 "  - $p"; done
  exit 1
fi
print "release: preflight ok (Petal $VERSION, ${CSC_NAME#$PREFIX}, profile $PROFILE)"
(( CHECK_ONLY )) && exit 0

# Build, sign and notarise. electron-builder wants the identity without its "Developer ID Application: " prefix,
# and reads the notary profile from APPLE_KEYCHAIN_PROFILE; @electron/notarize staples the .app.
rm -rf "$OUT"
npx electron-vite build
env -u APPLE_ID -u APPLE_APP_SPECIFIC_PASSWORD -u APPLE_API_KEY -u APPLE_API_KEY_ID -u APPLE_API_ISSUER \
  APPLE_KEYCHAIN_PROFILE="$PROFILE" \
  npx electron-builder --mac --publish never -c.mac.identity="${CSC_NAME#$PREFIX}" -c.mac.notarize=true

# Verify the app as built, inside the dmg, and inside the zip the updater downloads.
verify_app() {
  local app=$1 what=$2 verdict
  codesign --verify --deep --strict --verbose=2 "$app" || { print -u2 "release: codesign rejected $what"; exit 1; }
  verdict=$(spctl -a -vv "$app" 2>&1) || { print -u2 "release: Gatekeeper rejected $what:\n$verdict"; exit 1; }
  print "$verdict"
  [[ $verdict == *"Notarized Developer ID"* ]] || { print -u2 "release: $what is not notarised"; exit 1; }
  xcrun stapler validate "$app" || { print -u2 "release: $what has no stapled ticket"; exit 1; }
  print "release: verified $what"
}
DMG="$OUT/Petal-$VERSION-universal.dmg"
ZIP=("$OUT"/Petal-"$VERSION"-universal*.zip)
for f in "$DMG" "${ZIP[1]}" "$OUT/latest-mac.yml"; do
  [[ -f $f ]] || { print -u2 "release: missing $f"; exit 1; }
done
verify_app "$OUT/mac-universal/Petal.app" "the built app"

SCRATCH=$(mktemp -d)
trap 'hdiutil detach -quiet "$SCRATCH/dmg" 2>/dev/null; rm -rf "$SCRATCH"' EXIT
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$SCRATCH/dmg" "$DMG"
verify_app "$SCRATCH/dmg/Petal.app" "the app inside the dmg"
ditto -x -k "${ZIP[1]}" "$SCRATCH/zip"
verify_app "$SCRATCH/zip/Petal.app" "the app inside the zip"

if (( ! PUBLISH )); then
  print "release: built and verified in $OUT. Nothing published (add --publish for a draft release)."
  exit 0
fi

# Draft only (releaseType: draft in electron-builder.yml): no one gets the update until she publishes it on GitHub.
files=()
for f in "$OUT"/Petal-"$VERSION"-* "$OUT/latest-mac.yml"; do files+=(-f "$f"); done
npx electron-builder publish "${files[@]}" --version "$VERSION" --policy always
print "release: draft release v$VERSION uploaded. Review and publish it on GitHub by hand."
