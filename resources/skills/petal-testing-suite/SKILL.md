---
name: petal-testing-suite
description: Draw up and build a real testing suite for the current project, then hand Petal's Testing tab the pipeline to run. Use when the user says "testing suite", "set up tests", "test suite for this project", "add tests to this repo", or runs /petal-testing-suite.
---

# Testing suite

Build a suite that catches real bugs in this project, run it until it is green or the failures are reported as bugs, and leave Petal a pipeline it can run.

## 1. Inspect first

Read before proposing anything:

- Languages, frameworks and package managers (package.json, pyproject.toml, go.mod, Cargo.toml, Gradle, Xcode, pubspec.yaml).
- Tests that already exist, their runner and config, and whether they pass today.
- CI workflows (.github/workflows, azure-pipelines.yml, .gitlab-ci.yml) and the commands they run.
- Mobile: React Native, Expo, Flutter, native iOS or Android, and any `.maestro/` flows. Check `maestro --version`.
- The most important paths: sign-in, money, data writes, anything the README or routes say users rely on.

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

## 4. Hand Petal the pipeline

Write `.petal/pipeline.json` at the repo root: the stages in run order, each a short name (40 characters at most) and one shell command (one line, run from the repo root), 12 stages at most.

```json
[
  { "name": "Typecheck", "command": "npm run typecheck" },
  { "name": "Lint", "command": "npm run lint" },
  { "name": "Unit", "command": "npm test" },
  { "name": "Mobile flows", "command": "maestro test .maestro" }
]
```

Make sure `.petal/.gitignore` exists and contains `*`, so the folder stays out of git.

Never commit. Leave every change for the user to review.

## 5. Report

A short summary: what was added, the stage commands, pass and fail counts, and any real bugs found. End with one line: open Petal's Testing tab to run the pipeline.
