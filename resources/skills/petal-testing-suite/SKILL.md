---
name: petal-testing-suite
description: As a task's testing agent, draw up, build or update that task's testing suite, then hand it to Petal's Testing tab to run. Use when the user says "testing suite", "update the testing suite", "set up tests", "test suite for this task", "add tests to this repo", or runs /petal-testing-suite.
---

# Testing suite

Build a suite that catches real bugs in the task you are working on, run it until it is green or the failures are reported as bugs, and leave Petal the suite to run. Petal keeps one suite per task, not per project.

## 0. Which task, and whether you may change its suite

Only a task's testing agent changes its suite. Petal starts that agent in its own tab, with a request that names the task ("for task t-1a2b") and says "You are this task's testing agent". Petal ignores a suite change from any other session, including the one doing the task.

- You were started that way, or that request is earlier in this conversation: you are the testing agent for that task id. Saying "update the testing suite" later works the same way.
- Otherwise: don't write a suite file. Say in one line that the task's suite belongs to its testing agent, and that the user can start it from Petal's Testing tab on the task (Ask Claude to draw one up).

To update an existing suite (add, change or remove stages), read `.petal/suites/<task id>.json` first and keep what still applies.

## 1. Inspect first

Read before proposing anything:

- Languages, frameworks and package managers (package.json, pyproject.toml, go.mod, Cargo.toml, Gradle, Xcode, pubspec.yaml).
- Tests that already exist, their runner and config, and whether they pass today.
- CI workflows (.github/workflows, azure-pipelines.yml, .gitlab-ci.yml) and the commands they run.
- Mobile: React Native, Expo, Flutter, native iOS or Android, and any `.maestro/` flows. Check `maestro --version`.
- The paths this task touches first, then the most important ones: sign-in, money, data writes, anything the README or routes say users rely on.

## 2. Propose, then build

Say in a few lines what the suite will be: runners, the stages, which paths get tests first, and anything that needs installing. Then build it.

- **Runners:** reuse what is installed. Add a new one only when nothing fits, and prefer the stack's standard choice (Vitest or Jest, pytest, go test, cargo test, XCTest, JUnit, Playwright).
- **Config:** add it only if missing. Never rewrite working config.
- **Scripts:** one command per stage where the stack allows it: typecheck, lint, test, e2e.
- **Tests:** a first meaningful set for the most important paths. Real inputs, real assertions, edge cases and failure paths. No placeholders, no `expect(true)`, no snapshot-only tests.
- **Mobile:** when it is a mobile app and Maestro is present or a good fit, add flows under `.maestro/` for the main journeys.
- **Installing:** dev dependencies inside the project are fine after saying what and why. Ask before installing anything globally (Maestro, browsers, SDKs).

## 3. Run it

Run every stage. Make it green by fixing setup and test mistakes. When a test fails because the code is wrong, keep the test and report it as a bug with the file and line. Never weaken, skip or delete a test to get green.

## 4. Hand Petal the suite

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

## 5. Report

A short summary: what was added, the stage commands, pass and fail counts, and any real bugs found. End with one line: open Petal's Testing tab on this task to run the suite.
