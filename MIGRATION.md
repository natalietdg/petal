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
- [x] File splits and fixes from the code-quality audit:
  - [x] Scene helpers deduped into a shared kit; howl and study share a wizard kit. **outlined/layers/stamp/sprite/barkCell live only in scenes/kit.ts; scenes/wizard-kit.ts builds hearth, bookcase, sun, lantern, chest, staff, gramophone, strands and glows per class prefix ('h', 'hs'). SVG byte-identical to the Phase 2 commit for all 9 scenes plus none/bogus/toString/__proto__ (13 ids).**
  - [x] Split scenes, history, history-ipc, workflow, customize, cat (art data out), main (tab sessions, look). **scenes.ts is the registry, one file per scene; renderer history → history-state/-list/-tags/-preview + shell; main history-ipc → history, tags, flow, handoff IPC + history-turns.ts; main workflow → workflow-common/-today/-setup/-time/-handoffs/-frontmatter behind the same exports; customize → kit, look, prompts, hook + shell; cat-art.ts; main.ts → tabs.ts, look.ts, customize-ipc.ts. Public APIs kept.**
  - [x] Dev snapshot code moves to src/dev and loads only in snapshot runs. **Dynamic import, its own chunk (out/main/chunks/snapshot-*.js); snapshot-mode.ts holds the only seams: scratch userData, the fixture session (replaces fakeTranscript/fakeStatus) and counters (replace flow/hook stats).**
  - [x] One `ps` poll shared across tabs. **process-poll.ts runs one `ps` per tick for every ReaderFeed; fixture feeds don't trigger it.**
  - [x] organizer.json cached by mtime. **session-organizer.loadCached() (mtime + size) feeds tab labels.**
  - [x] Dead code: reader.js DETAILS branch, flow.css .flow-headline/.flow-why/.flow-files, history:preview channel + helpers, windowDays, unused exports, scenes.js default W/H. **DETAILS and default W/H were already gone in Phase 2; the rest removed, plus tabs.getActiveId and links-store's duplicate SESSION_ID (session-id.ts).**
  - [x] Magic numbers become named constants
  - [x] Shared `el()` / `timeOf` renderer helpers. **el in dom.ts, timeOf in format.ts (reader, history, workflow, customize).**
  - [x] Unreferenced build/ art removed (compare.png, dango, leaf)
  - [x] Renderer-only libraries are devDependencies. **node-pty is the only runtime dependency; app.asar 204 MB → 13 MB, Petal.app 716 MB → 520 MB.**
- [x] ESLint (typescript-eslint), Vitest for main-process units, the snapshot harness as E2E. **`npm run lint` 0 errors; `npm test` 9 files, 133 passed + 1 expected fail (pins the case-only tag rename bug).**
- [x] GitHub Actions CI: typecheck, lint, tests on every push. **.github/workflows/ci.yml, macos-latest, Node 22.**
- [x] Gate: CI green on GitHub. **Typecheck exit 0, lint 0 errors, tests pass, packaged universal app (arm64 run) 75 ok / 0 FAIL with the same assertion set as Phase 2, scene matrix 216 combos with 0 console/net errors, 0 missing CSS rules, rect counts identical to Phase 2. CI run 37422820364 green.**
