---
name: petal-testing-suite
description: Set up or extend this repo's testing suite (one per repo, shared by every session and worktree), then hand it to Petal's Testing tab to run. Use when the user says "testing suite", "update the testing suite", "set up tests", "add tests to this repo", or runs /petal-testing-suite.
---

# Testing suite

One suite per repo. Any Claude session that hears "testing suite" reads the repo's suite (or creates it) and adds to it. Catch real bugs, record them in a shape that pastes into Azure DevOps, and leave Petal the suite to run.

Scenarios come first. The user decides what "done" means: you write new scenarios, the user reviews them in Petal, and only then do you write their tests.

## 0. Find the repo's files

The suite lives in Petal, not in the repo: `~/.petal/repos/<repoKey>/`. Every session and worktree of the repo shares that one folder. Work out the path:

1. The repo's main checkout is the parent folder of git's common dir:

```sh
dirname "$(git rev-parse --path-format=absolute --git-common-dir)"
```

   Outside git, use the current folder.
2. `<repoKey>` is that absolute path with every character that is not a letter or digit replaced by `-`. For example, `/home/me/shop-app` becomes `-home-me-shop-app`, so the folder is `~/.petal/repos/-home-me-shop-app/`.

```sh
echo "$HOME/.petal/repos/$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)" | sed 's/[^A-Za-z0-9]/-/g')"
```

- `<suite folder>/suite.json`: the stages Petal runs.
- `<suite folder>/criteria.md`: scenarios, manual checks and bugs.
- `<suite folder>/tests/`: the test code, mirroring the repo's test layout.

Petal's request may name both paths; use those. Create the folder if it is missing. Read both files first if they exist and keep everything that still applies. Lines other sessions wrote stay as they are.

**Never write suite or criteria files inside the repo** (no `.petal/suite.json`, no `.petal/criteria.md`). Test code lives in Petal too: nothing test-related is written in the repo, no test files, configs or fixtures. Tests already committed in the repo stay where they are. Commands still run in the checkout you are in.

## 1. Inspect first

Read before proposing anything:

- Languages, frameworks and package managers (package.json, pyproject.toml, go.mod, Cargo.toml, Gradle, Xcode, pubspec.yaml).
- Tests that already exist, their runner and config, and whether they pass today.
- CI workflows (.github/workflows, azure-pipelines.yml, .gitlab-ci.yml) and the commands they run.
- Mobile: React Native, Expo, Flutter, native iOS or Android, and any `.maestro/` flows. Check `maestro --version`.
- The paths the current work touches first, then the riskiest ones: sign-in, money, data writes.

## 2. Write new scenarios, then stop

Add scenarios under `## Scenarios` in `criteria.md`. Create the file with `## Scenarios`, `## Manual` and `## Bugs` headings if it is missing. One line each, parts split by ` · ` exactly:

```
- [todo] a refund larger than the amount paid is refused · ticket: AB#10427 · level: regression · from: prd
```

- One plain-language rule per line: behaviour someone could observe.
- Cover the happy path, edge cases and failure paths.
- `ticket:` the ADO id of the work it belongs to (from the task, branch or request). `level:` smoke (fast, every run), regression (the full check) or staging (needs a deployed env; opt-in).
- Petal's request may carry task notes or a PRD. Write at least one scenario per rule there, ending `· from: notes` or `· from: prd`.

**Stop only when you added new scenarios.** End with one line: new scenarios are ready for review in Petal's Testing tab. Wait for the go-ahead (Petal sends "the scenarios look right"), read the file again, then write their tests. No new scenarios: carry straight on.

## 3. Add the tests

Say in a few lines what you will add: runners, stages, which scenarios get tests first, anything to install. Then build it.

- **Where:** test code goes in `<suite folder>/tests/`, mirroring the repo's layout: the repo's `src/refund.test.ts` would be `<suite folder>/tests/src/refund.test.ts`. Source is imported from the checkout, never copied.
- **Runners:** reuse the repo's runner; add one only when nothing fits.
- **Config:** a stage runs the repo's runner against `<suite folder>/tests/` with a config kept in the suite folder, whose root is the checkout the stage runs in (`process.cwd()`), so each worktree tests its own code. Never touch the repo's config. For vitest, `<suite folder>/vitest.config.mjs` is a plain object (no imports, so it loads from outside the repo):

```js
const repo = process.cwd();
const suite = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
export default {
  root: repo,
  resolve: {
    alias: [
      { find: /^@repo\/(.*)$/, replacement: `${repo}/$1` }, // source: import { refund } from '@repo/src/refund'
      { find: /^([^./\0][^:]*)$/, replacement: `${repo}/node_modules/$1` }, // bare imports from the repo's node_modules
    ],
  },
  server: { fs: { allow: [repo, suite] } },
  test: {
    include: [`${suite}/tests/**/*.test.{ts,tsx,js,mjs}`],
    setupFiles: [`${repo}/test/setup.ts`], // the repo's own setupFiles, if any
    reporters: ['default'],
  },
};
```

  Its stage command is `npx vitest run --config <suite folder>/vitest.config.mjs`. Other runners follow the same idea: jest with `--rootDir` on the checkout and `--roots` on the suite's tests, playwright with `testDir` in a suite-folder config, maestro with the flow paths under the suite folder.
- **Tests:** real inputs and real assertions; no placeholders or snapshot-only tests. Name each test on its scenario's line, one `test:` part per test, naming its path in Petal:

```
- [pass] a refund larger than the amount paid is refused · test: ~/.petal/repos/-home-me-shop-app/tests/src/refund.test.ts::refuses over-refund · ticket: AB#10427 · level: regression
```

  `[pass]` once all its tests pass, `[fail]` while any fails, `[todo]` if you can't test it yet (say why).
- **Manual checks** (what can't be automated) go under `## Manual`:

```
- [todo] receipt email arrives on a real phone · ticket: AB#10427 · level: manual
  - Prereq: staging account with a verified email
  - Steps: pay RM10, open the inbox on the phone
  - Expected: receipt within 1 minute, amount RM10.00
```

  Leave the status for the user; she ticks pass, fail or blocked in Petal.
- **Installing:** project dev dependencies are fine after saying what and why. Ask before anything global.

## 4. Run it, record bugs

Run every stage you touched. Fix setup and test mistakes. When a test fails because the app is wrong, keep the test and record the bug under `## Bugs`; don't fix app code unless the user asked you to:

```
- [open] coupon can take the total below zero · test: ~/.petal/repos/-home-me-shop-app/tests/src/checkout/coupon.test.ts::caps at the total · ticket: AB#10427
  - Steps: add a RM5 item, apply coupon SAVE10
  - Expected: total RM0.00
  - Actual: total -RM5.00
  - Env: local, node 22, commit abc123
  - Evidence: vitest output: expected 0, received -5
```

`[fixed]` once its test passes.

**Never delete, skip or weaken a test** (no `.skip`, no removed assertions, no loosened expectations) without the user's say-so. The test lock may refuse it.

## 5. Hand Petal the suite

Write `suite.json` in the suite folder from step 0, never in the repo: stages in run order, 20 at most, each a short name (60 characters at most), one shell command (one line, run from the repo root) and a level. Keep `keepGoing` and `autoRun` as they are.

```json
{
  "stages": [
    { "name": "Typecheck", "command": "npm run typecheck", "level": "smoke" },
    { "name": "Unit", "command": "npx vitest run --config ~/.petal/repos/-home-me-shop-app/vitest.config.mjs", "level": "regression" },
    { "name": "Staging e2e", "command": "npm run e2e:staging", "level": "staging", "optIn": true, "note": "needs VPN and a staging login" }
  ]
}
```

Staging stages are `"optIn": true` with a `note` saying why or what blocks them; Petal never runs them unless the user turns them on. Add stages; don't remove one another session added unless the user asks. Petal shows any change with an Undo.

Never commit. Leave every change for the user to review.

## 6. Report

A short summary: what you added, stage commands, scenarios passing, failing or with no test, manual checks waiting, and the bugs you recorded. End with one line: open Petal's Testing tab to run the suite.
