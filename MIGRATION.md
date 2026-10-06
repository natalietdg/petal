# TypeScript migration

Same Electron app, standard tooling. The app keeps working after every phase.
Gate for every phase: typecheck passes, the packaged-app snapshot run stays at 68 ok / 0 FAIL, then commit.

## Phase 1: tooling + main process
- [x] TypeScript (strict), `electron-vite` for main/preload/renderer builds. **TS 5.9.3 strict, electron-vite 5 builds out/main + out/preload; renderer still static files from src/renderer (moves into the Vite build in Phase 2).**
- [x] `electron-builder` replaces `electron-packager` (arm64 + x64 universal, .dmg target, signing config ready for the Developer ID cert, auto-update config stubbed). **electron-builder.yml: universal dmg + zip in dist.noindex, `identity: null` until the cert exists, hardened runtime + build/entitlements.mac.plist, GitHub publish stub. `lipo -archs`: x86_64 arm64 on Petal and node-pty's pty.node.**
- [x] `src/main/**` and `src/preload` converted to `.ts`, typed IPC contract shared with the renderer. **src/shared/ipc.ts lists every channel; main/ipc.ts and preload.ts only accept those.**
- [x] `scripts/install-when-free.sh` points at the new build output. **dist.noindex/mac-universal/Petal.app; also stages the copy and swaps by rename.**
- [x] Gate: `tsc --noEmit` clean, snapshot 68 ok / 0 FAIL. **typecheck exit 0; packaged universal app 68 ok / 0 FAIL, same assertions as the pre-migration baseline. Run snapshots with `arch -arm64 <binary>`; the x64 slice is checked statically (`lipo -archs`, `file`) so macOS never shows its Intel-app prompt.**

Audit fixes folded into Phase 1: quoted resume command, async `claudePath`, one atomic-write helper, one IPC guard, fixture refuses ~/.claude.

## Phase 2: renderer
- [ ] Global `PastelTerm.*` script tags become ES modules bundled by Vite
- [ ] Renderer converted to `.ts`; scenes typed (`Scene`, `paint`, `moving`)
- [ ] Reply box sends only when the tab's Claude is live, and strips ESC
- [ ] One overlay manager for History / Workflow / Customize
- [ ] Renderer shows `{ error }` replies, then the remaining IPC channels can return errors instead of rejecting
- [ ] Gate: typecheck, snapshot, 216-combo scene matrix 0 errors

## Phase 3: structure + quality
- [ ] File splits and fixes from the code-quality audit:
  - [ ] Scene helpers deduped into a shared kit; howl and study share a wizard kit
  - [ ] Split scenes.js, history.js, history-ipc, workflow.js, customize.js, cat.js (art data out), main.js (tab sessions, look)
  - [ ] Dev snapshot code moves to src/dev and loads only in snapshot runs
  - [ ] One `ps` poll shared across tabs
  - [ ] organizer.json cached by mtime
  - [ ] Dead code: reader.js DETAILS branch, flow.css .flow-headline/.flow-why/.flow-files, history:preview channel + helpers, windowDays, unused exports, scenes.js default W/H
  - [ ] Magic numbers become named constants
  - [ ] Shared `el()` / `timeOf` renderer helpers
  - [ ] Unreferenced build/ art removed (compare.png, dango, leaf)
- [ ] ESLint (typescript-eslint), Vitest for main-process units, Playwright or the snapshot harness as E2E
- [ ] GitHub Actions CI: typecheck, lint, tests on every push
- [ ] Gate: CI green on GitHub
