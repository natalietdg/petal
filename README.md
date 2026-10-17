# Petal

A calm, readable pastel terminal for Claude Code. Electron + TypeScript, macOS.

## Build

Use Node 22 (`.nvmrc`); electron-builder fails under Node 18.

```sh
npm install
npm run dev            # run from source
npm run package        # unsigned universal .app in dist.noindex/mac-universal
npm run dist           # adds the .dmg and .zip
```

### Signed local build

`package:local` signs with your own Apple Development certificate, named through electron-builder's `CSC_NAME`:

```sh
CSC_NAME="Apple Development: <you> (<id>)" npm run package:local
```

It stops with an error if `CSC_NAME` is unset, so it never produces an unsigned build by accident. List your identities with `security find-identity -v -p codesigning`.

## Checks

```sh
npm run typecheck
npm run lint
npm test
```

Before handing a branch over, run the whole snapshot sequence under a scratch HOME with a stand-in `claude` (exit 0 only on fail=0): `scripts/snapshot-full-fake-home.sh [scratch-dir]`.
