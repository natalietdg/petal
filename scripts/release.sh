#!/bin/zsh
# Signed, notarised, stapled Petal for Apple Silicon (arm64) and Intel (x64). Uploads to the R2 bucket behind petal-downloads only with --publish.
# Usage: CSC_NAME="Developer ID Application: Name (DC4T539CW7)" scripts/release.sh [--check] [--publish]
set -euo pipefail
cd "${0:A:h}/.."

BUCKET=petal-releases # R2, served by the petal-downloads Worker
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
if [[ -n $(ls -A src/renderer/cats-local 2>/dev/null) ]]; then
  problem "src/renderer/cats-local has private cats; release from a clean worktree, never this checkout."
fi
VERSION=$(node -p "require('./package.json').version")
grep -q "^## \[$VERSION\]" CHANGELOG.md 2>/dev/null || problem "CHANGELOG.md has no \"## [$VERSION]\" entry."
if (( PUBLISH )) && ! npx -y wrangler@latest whoami >/dev/null 2>&1; then
  problem "--publish needs wrangler logged in to the Cloudflare account that owns the $BUCKET bucket (npx wrangler login)."
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
PASTEL_RELEASE_BUILD=1 npx electron-vite build # compiles the src/dev snapshot harness out
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
[[ -f "$OUT/latest-mac.yml" ]] || { print -u2 "release: missing $OUT/latest-mac.yml"; exit 1; }
SCRATCH=$(mktemp -d)
trap 'for m in "$SCRATCH"/dmg-*(N); do hdiutil detach -quiet "$m" 2>/dev/null; done; rm -rf "$SCRATCH"' EXIT
typeset -A APP_DIR=(arm64 mac-arm64 x64 mac) # electron-builder's per-arch output folders
for arch in arm64 x64; do
  DMG="$OUT/Petal-$VERSION-$arch.dmg"
  ZIP="$OUT/Petal-$VERSION-$arch-mac.zip"
  for f in "$DMG" "$ZIP"; do
    [[ -f $f ]] || { print -u2 "release: missing $f"; exit 1; }
  done
  grep -qF "url: ${ZIP:t}" "$OUT/latest-mac.yml" || { print -u2 "release: latest-mac.yml does not list ${ZIP:t}"; exit 1; }
  verify_app "$OUT/${APP_DIR[$arch]}/Petal.app" "the built $arch app"
  scripts/privacy-scan.sh "$OUT/${APP_DIR[$arch]}/Petal.app" "the built $arch app"

  # lzma (ULMO, macOS 10.15+) is ~25% smaller than electron-builder's ULFO; the dmg is unsigned and not in latest-mac.yml.
  hdiutil convert -quiet "$DMG" -format ULMO -o "$SCRATCH/$arch.dmg"
  mv -f "$SCRATCH/$arch.dmg" "$DMG"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$SCRATCH/dmg-$arch" "$DMG"
  verify_app "$SCRATCH/dmg-$arch/Petal.app" "the $arch app inside the dmg"
  scripts/privacy-scan.sh "$SCRATCH/dmg-$arch/Petal.app" "the $arch app inside the dmg"
  ditto -x -k "$ZIP" "$SCRATCH/zip-$arch"
  verify_app "$SCRATCH/zip-$arch/Petal.app" "the $arch app inside the zip"
done

if (( ! PUBLISH )); then
  print "release: built and verified in $OUT. Nothing published (add --publish for a draft release)."
  exit 0
fi

# The app files go up first and latest-mac.yml last, so no installed Petal sees an update before its files exist.
SITE=https://petal-downloads.natalieleong19.workers.dev
for f in "$OUT"/Petal-"$VERSION"-*.{dmg,zip,blockmap}(N); do
  npx -y wrangler@latest r2 object put "$BUCKET/${f:t}" --file "$f" --remote
done
# A Worker that only knows universal names would 404 these, and every installed Petal would fail to update.
for f in "$OUT"/Petal-"$VERSION"-*.{dmg,zip}(N); do
  code=$(curl -s -o /dev/null -I -w '%{http_code}' "$SITE/${f:t}")
  [[ $code == 200 ]] || { print -u2 "release: $SITE/${f:t} answered $code; deploy petal-downloads first. latest-mac.yml NOT uploaded."; exit 1; }
done
npx -y wrangler@latest r2 object put "$BUCKET/latest-mac.yml" --file "$OUT/latest-mac.yml" --remote
print "release: Petal $VERSION uploaded to $BUCKET. Live at $SITE/download?arch=arm64 and ?arch=x64"
