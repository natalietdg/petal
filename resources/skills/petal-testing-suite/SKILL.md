---
name: petal-testing-suite
description: As a task's testing agent, draw up, build or update that task's testing suite, then hand it to Petal's Testing tab to run. Use when the user says "testing suite", "update the testing suite", "set up tests", "test suite for this task", "add tests to this repo", or runs /petal-testing-suite.
---

# Testing suite

Build a suite that catches real bugs in the task you are working on, run it until it is green or the failures are reported as bugs, and leave Petal the suite to run. Petal keeps one suite per task, not per project.

Scenarios come first. The user decides what "done" means: you write the rules as plain-language scenarios, the user reviews them in Petal, and only then do you write tests from them.

## 0. Which task, and whether you may change its suite

Only a task's testing agent changes its suite. Petal starts that agent in its own tab, with a request that names the task ("for task t-1a2b") and says "You are this task's testing agent". Petal ignores a suite change from any other session, including the one doing the task.

- You were started that way, or that request is earlier in this conversation: you are the testing agent for that task id. Saying "update the testing suite" later works the same way.
- Otherwise: don't write a suite file. Say in one line that the task's suite belongs to its testing agent, and that the user can start it from Petal's Testing tab on the task (Ask Claude to draw one up).

To update an existing suite (add, change or remove stages), read `.petal/suites/<task id>.json` first and keep what still applies. Scenarios already in the criteria file that have tests stay as they are; only new ones wait for review.

## 1. Inspect first

Read before proposing anything:

- Languages, frameworks and package managers (package.json, pyproject.toml, go.mod, Cargo.toml, Gradle, Xcode, pubspec.yaml).
- Tests that already exist, their runner and config, and whether they pass today.
- CI workflows (.github/workflows, azure-pipelines.yml, .gitlab-ci.yml) and the commands they run.
- Mobile: React Native, Expo, Flutter, native iOS or Android, and any `.maestro/` flows. Check `maestro --version`.
- The paths this task touches first, then the most important ones: sign-in, money, data writes, anything the README or routes say users rely on.

## 2. Write the scenarios, then stop

Write the task's scenarios under `## Scenarios` in its criteria file, `.petal/criteria/<task id>.md` (Petal's request names the exact path; create the file with a `## Scenarios` and a `## Bugs` heading if it is missing). One line each:

```
- [todo] a refund larger than the amount paid is refused · from: prd · task: t-1a2b
```

- One plain-language rule per line: behaviour someone could observe, not how the code does it.
- Cover the happy path, edge cases and failure paths (bad input, empty states, limits, errors from other services).
- Petal's request may carry the task's notes and its PRD, labelled as the source of scenarios. Write at least one scenario for each rule there and end its line with `· from: notes` or `· from: prd`. Scenarios you add yourself have no `from:`.
- Use `[todo]`: no test exists yet. Keep `· task: <your task id>` last, and the ` · ` separators exactly.

Then stop. Don't write any test, config or suite file yet. End your reply with one line: the scenarios are ready for review in Petal's Testing tab. Wait for the user's go-ahead: Petal sends it into this tab as a message saying the scenarios look right. The user may edit the file before that, so read it again when the go-ahead arrives, and treat its scenarios as the rules to test. A message asking for changes instead: change the scenarios, then stop again.

## 3. Propose, then build

Only after the go-ahead. Say in a few lines what the suite will be: runners, the stages, which paths get tests first, and anything that needs installing. Then build it.

- **Runners:** reuse what is installed. Add a new one only when nothing fits, and prefer the stack's standard choice (Vitest or Jest, pytest, go test, cargo test, XCTest, JUnit, Playwright).
- **Config:** add it only if missing. Never rewrite working config.
- **Scripts:** one command per stage where the stack allows it: typecheck, lint, test, e2e.
- **Tests:** one or more per scenario, real inputs and real assertions. No placeholders, no `expect(true)`, no snapshot-only tests. Name each test on its scenario's line, one `test:` part per test (path, `::`, test name), so Petal can count which scenarios pass:

```
- [pass] a refund larger than the amount paid is refused · test: src/refund.test.ts::refuses over-refund · test: e2e/refund.spec.ts::shows the limit · from: prd · task: t-1a2b
```

  A scenario is `[pass]` once all its tests pass and `[fail]` while any fails. One you can't test yet stays `[todo]`; say why in your report.
- **Mobile:** when it is a mobile app and Maestro is present or a good fit, add flows under `.maestro/` for the main journeys.
- **Installing:** dev dependencies inside the project are fine after saying what and why. Ask before installing anything globally (Maestro, browsers, SDKs).

## 4. Run it

Run every stage. Make it green by fixing setup and test mistakes. When a test fails because the code is wrong, keep the test and record the bug; don't fix app code. Never weaken, skip or delete a test to get green.

Record each bug as one line under `## Bugs` in the same criteria file, so Petal hands it to the task's bug fix agent:

```
- [fail] coupon can take the total below zero · test: src/checkout/coupon.test.ts::caps at the total · task: t-1a2b
```

Use your task id after `task:`, the failing test after `test:` (path, `::`, test name), and keep the ` · ` separators exactly.

## 5. Hand Petal the suite

Write `.petal/suites/<task id>.json` at the repo root: the stages in run order, each a short name (60 characters at most) and one shell command (one line, run from the repo root), 20 stages at most. Keep `keepGoing` and `autoRun` as they are if the file has them.

```json
{
  "stages": [
    { "name": "Typecheck", "command": "npm run typecheck" },
    { "name": "Lint", "command": "npm run lint" },
    { "name": "Unit", "command": "npm test" },
    { "name": "Mobile flows", "command": "maestro test .maestro" }
  ]
}
```

Petal takes your change on its own and shows it in the task's Testing view with an Undo. A file it can't read is not used; the old suite stays and Petal says why. Don't edit `.petal/tasks.json` or `.petal/pipeline.json`.

Make sure `.petal/.gitignore` exists and contains `*`, so the folder stays out of git.

Never commit. Leave every change for the user to review.

## 6. Report

A short summary: what was added, the stage commands, how many scenarios pass, fail or have no test yet, and the bugs you recorded. End with one line: open Petal's Testing tab on this task to run the suite.
