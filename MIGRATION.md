# TypeScript migration

Same Electron app, standard tooling. The app keeps working after every phase.
Gate for every phase: typecheck passes, the packaged-app snapshot run has 0 FAIL (75 ok since Phase 2), then commit.
Package with Node 22 (.nvmrc); electron-builder fails under Node 18.

## Phase 1: tooling + main process
- [x] TypeScript (strict), `electron-vite` for main/preload/renderer builds. **TS 5.9.3 strict, electron-vite 5 builds out/main + out/preload; renderer still static files from src/renderer (moves into the Vite build in Phase 2).**
- [x] `electron-builder` replaces `electron-packager` (arm64 + x64 universal, .dmg target, signing config ready for the Developer ID cert, auto-update config stubbed). **electron-builder.yml: universal dmg + zip in dist.noindex, `identity: null` until the cert exists, hardened runtime + build/entitlements.mac.plist, GitHub publish stub. `lipo -archs`: x86_64 arm64 on Petal and node-pty's pty.node.**
- [x] `src/main/**` and `src/preload` converted to `.ts`, typed IPC contract shared with the renderer. **src/shared/ipc.ts lists every channel; main/ipc.ts and preload.ts only accept those.**
- [x] `scripts/install-when-free.sh` points at the new build output. **dist.noindex/mac-universal/Petal.app; also stages the copy and swaps by rename.**
- [x] Gate: `tsc --noEmit` clean, snapshot 68 ok / 0 FAIL. **typecheck exit 0; packaged universal app 68 ok / 0 FAIL, same assertions as the pre-migration baseline. Run snapshots with `arch -arm64 <binary>`; the x64 slice is checked statically (`lipo -archs`, `file`) so macOS never shows its Intel-app prompt.**

Audit fixes folded into Phase 1: quoted resume command, async `claudePath`, one atomic-write helper, one IPC guard, fixture refuses ~/.claude.

## Phase 2: renderer
- [x] Global `PastelTerm.*` script tags become ES modules bundled by Vite. **electron-vite builds src/renderer into out/renderer; index.html loads one module (app.ts). xterm, marked, dompurify, mermaid (lazy chunk) and fontsource CSS are package imports; fonts ship as files so the CSP is unchanged (`script-src 'self'`, no unsafe-eval) and the mindmap still renders. `window.PastelTerm` stays as the snapshot run's debug handle.**
- [x] Renderer converted to `.ts`; scenes typed (`Scene`, `paint`, `moving`). **scenes/kit.ts holds the `Scene` contract and shape kit; scenes.ts imports each scene module. CATS/PROPS `satisfies` typed records, window.pastel typed as `PastelApi`, no `any`. Every scene's SVG output is byte-identical to the JS version (11 ids compared).**
- [x] Reply box sends only when the tab's Claude is live, and strips ESC. **Not live: text kept, "Start Claude in this tab first" shown, nothing written. C0 controls except \n/\t stripped before the bracketed paste. 3 snapshot checks.**
- [x] One overlay manager for History / Workflow / Customize. **overlays.ts: one open at a time, Esc closes it (Workflow included), reader + reply box only when none is open. 4 snapshot checks.**
- [x] Renderer shows `{ error }` replies, then the remaining IPC channels can return errors instead of rejecting. **All 17 remaining channels are `Guarded<>`; guard() always returns `{ error }` and a type-level check fails typecheck if one isn't. 1 snapshot check.**
- [x] Gate: typecheck, snapshot, 216-combo scene matrix 0 errors. **`npm run typecheck` covers main + renderer (tsconfig.web.json), exit 0. Packaged universal app (arm64 run): 75 ok / 0 FAIL (was 68). Scene matrix on the Vite build: 216 combos, 0 console errors, 0 missing CSS rules, 0 net errors.**

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
