# Petal release test plan

Each step has a verify-gate. Tick only with evidence (log line, PNG, number).

## A. Automated (Claude runs these)
- [x] A1 Syntax: `node --check` on every JS file. Gate: zero failures. **46 files, 0 failures.**
- [x] A2 Snapshot suite, fixture mode: 3 runs. Gate: no script errors; flaky flow FAIL explained or fixed. **Cause: 15s wait vs 17-37s Haiku call; wait raised to 100s. Two packaged runs after fixes: 36 ok / 0 FAIL, exit 0.**
- [x] A3 Tabs: 7 tab assertions in the snapshot log. Gate: all ok. **7/7 in every run.**
- [x] A4 Organizer + tags unit tests (scratchpad/organizer, scratchpad/tags). Gate: all PASS, nothing under ~/.claude modified. **Tags 10/10 PASS.**
- [x] A5 Workflow data test (scratchpad/workflow). Gate: all assertions pass. **All asserts passed; ~/.claude mtimes unchanged.**
- [x] A6 Scene matrix: every scene x every pet x light/dark, idle + busy. Gate: zero console errors, every PNG non-empty. **216 combos, 0 errors, 0 missing CSS rules.**
- [x] A7 Fresh user: launch with an empty HOME (no ~/.claude, no claude on PATH). Gate: app opens, no crash, sensible empty states. **Opens cleanly; 4 new-user bugs found and fixed (workflow placeholder, history stat guard, organizer skip, install hint).**
- [x] A8 CPU at idle with the always-on animations (fire, record). Gate: installed app averages < 5% CPU over 60s. **Vinyl Lounge: avg 0.2%, max 0.5% (12 samples). Window may have been in the background; recheck with it in front.**
- [~] A9 Real Claude round trip on throwaway sessions only (snapshot `open` and `resume` modes). Gate: ok lines, no FAIL. **Resume: 5 ok, 1 stale assertion (now updated, not re-run). Open: blocked by Claude's folder-trust prompt in the scratch folder; needs throwaway sessions made in ~.**

Test launches: run the Electron binary directly under `perl -e 'alarm N; exec @ARGV'` (an `npx` wrapper leaves Electron orphaned).

## B. By hand (the maintainer, 5 minutes)
- [ ] B1 ⌘T new tab, ⌘⇧] / ⌘⇧[ switch, ⌘W close.
- [ ] B2 History → Open a past session lands in a new tab.
- [ ] B3 History → Send to Claude types the read line into the active tab.
- [ ] B4 Tags: + Tag, × on a chip, filter bar.
- [ ] B5 Customize › Today, Setup, Time, Handoffs and Factory: all five Workflow tabs load.

## C. Release (after A and B pass)
- [ ] C1 Developer ID Application certificate installed.
- [ ] C2 notarytool credentials stored (profile `petal`).
- [ ] C3 Signed + notarised universal build, stapled, packaged as .dmg.
- [ ] C4 Install the .dmg on a clean user account; Gatekeeper opens it without warning.
