// What a project tests with, read from its files (never run): runners, e2e and mobile tools, load tests and CI,
// plus the pipeline stages that follow from them. Read-only and shallow; testing-ipc.ts asks the folder gate first.
import fs from 'node:fs';
import path from 'node:path';
import { slugId, type StackItem, type StageConfig } from '../shared/testing';
import type { SlashItem } from '../shared/slash';

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'Pods', 'DerivedData', 'venv', '.venv', '__pycache__']);
const MAX_FILES = 4000; // the walk for *_test.go and flows stops here
const MAX_DEPTH = 4;

const read = (file: string): string => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const exists = (file: string): boolean => fs.existsSync(file);
const list = (dir: string): fs.Dirent[] => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };

interface PackageJson { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

export function packageJson(root: string): PackageJson {
  try { return JSON.parse(read(path.join(root, 'package.json')) || '{}') as PackageJson; } catch { return {}; }
}
export const scriptsOf = (root: string): Record<string, string> => packageJson(root).scripts ?? {};

// Files under root to a few levels, skipping dot folders other than .maestro and .github, and dependency folders.
function walk(root: string, accept: (rel: string) => boolean): string[] {
  const found: string[] = [];
  let seen = 0;
  const visit = (dir: string, depth: number) => {
    for (const entry of list(dir)) {
      if (++seen > MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(entry.name) && (!entry.name.startsWith('.') || entry.name === '.maestro')) visit(full, depth + 1);
      } else if (entry.isFile() && accept(path.relative(root, full))) found.push(path.relative(root, full));
    }
  };
  visit(root, 0);
  return found;
}

const firstConfig = (root: string, names: string[]): string | null => names.find((n) => exists(path.join(root, n))) ?? null;
const configNames = (base: string) => ['ts', 'mts', 'js', 'mjs', 'cjs', 'json'].map((ext) => `${base}.${ext}`);

// Node: dependencies and config files.
function nodeStack(root: string): StackItem[] {
  const pkg = packageJson(root);
  if (!exists(path.join(root, 'package.json'))) return [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name: string) => name in deps;
  const items: StackItem[] = [];
  const add = (id: string, label: string, kind: StackItem['kind'], dep: string | null, configs: string[]) => {
    const config = firstConfig(root, configs);
    if ((dep && has(dep)) || config) items.push({ id, label, kind, foundIn: dep && has(dep) ? 'package.json' : config ?? 'package.json', detail: dep && has(dep) ? `${dep} ${deps[dep]}` : undefined });
  };
  add('vitest', 'Vitest', 'unit', 'vitest', configNames('vitest.config'));
  add('jest', 'Jest', 'unit', 'jest', configNames('jest.config'));
  add('mocha', 'Mocha', 'unit', 'mocha', ['.mocharc.json', '.mocharc.js', '.mocharc.yml']);
  add('playwright', 'Playwright', 'e2e', has('@playwright/test') ? '@playwright/test' : 'playwright', configNames('playwright.config'));
  add('cypress', 'Cypress', 'e2e', 'cypress', configNames('cypress.config'));
  add('detox', 'Detox', 'mobile', 'detox', ['.detoxrc.js', '.detoxrc.json', '.detoxrc']);
  const library = Object.keys(deps).filter((d) => d.startsWith('@testing-library/'));
  if (library.length) items.push({ id: 'testing-library', label: 'Testing Library', kind: 'unit', foundIn: 'package.json', detail: library.join(', ') });
  if (has('typescript') && pkg.scripts && Object.values(pkg.scripts).some((s) => /\btsc\b/.test(s))) items.push({ id: 'tsc', label: 'TypeScript typecheck', kind: 'lint', foundIn: 'package.json' });
  if (has('eslint')) items.push({ id: 'eslint', label: 'ESLint', kind: 'lint', foundIn: 'package.json', detail: `eslint ${deps.eslint}` });
  return items;
}

function pythonStack(root: string): StackItem[] {
  const pyproject = read(path.join(root, 'pyproject.toml'));
  const setupCfg = read(path.join(root, 'setup.cfg'));
  const reqs = list(root).filter((e) => /^requirements.*\.txt$/.test(e.name)).map((e) => e.name);
  const where = exists(path.join(root, 'pytest.ini')) ? 'pytest.ini'
    : /\[tool\.pytest/.test(pyproject) ? 'pyproject.toml'
      : /\[tool:pytest\]/.test(setupCfg) ? 'setup.cfg'
        : exists(path.join(root, 'conftest.py')) ? 'conftest.py'
          : reqs.find((r) => /^pytest\b/m.test(read(path.join(root, r)))) ?? (/\bpytest\b/.test(pyproject) ? 'pyproject.toml' : null);
  const items: StackItem[] = where ? [{ id: 'pytest', label: 'pytest', kind: 'unit', foundIn: where }] : [];
  if (exists(path.join(root, 'tox.ini'))) items.push({ id: 'tox', label: 'tox', kind: 'unit', foundIn: 'tox.ini' });
  return items;
}

function goStack(root: string): StackItem[] {
  if (!exists(path.join(root, 'go.mod'))) return [];
  const tests = walk(root, (rel) => rel.endsWith('_test.go'));
  return tests.length ? [{ id: 'go', label: 'go test', kind: 'unit', foundIn: 'go.mod', detail: `${tests.length} *_test.go file${tests.length === 1 ? '' : 's'}, e.g. ${tests[0]}` }] : [];
}

function nativeStack(root: string): StackItem[] {
  const items: StackItem[] = [];
  if (exists(path.join(root, 'Cargo.toml'))) items.push({ id: 'cargo', label: 'cargo test', kind: 'unit', foundIn: 'Cargo.toml' });
  const xcode = list(root).find((e) => /\.(xcworkspace|xcodeproj)$/.test(e.name));
  if (xcode) items.push({ id: 'xcodebuild', label: 'XCTest (xcodebuild)', kind: 'unit', foundIn: xcode.name });
  else if (exists(path.join(root, 'Package.swift')) && exists(path.join(root, 'Tests'))) items.push({ id: 'swift', label: 'XCTest (swift test)', kind: 'unit', foundIn: 'Package.swift' });
  const gradle = firstConfig(root, ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'settings.gradle']);
  if (gradle) {
    const android = ['app/src/androidTest', 'src/androidTest'].find((d) => exists(path.join(root, d)));
    items.push({ id: 'gradle', label: android ? 'Gradle and Android tests' : 'Gradle tests', kind: android ? 'mobile' : 'unit', foundIn: android ?? gradle });
  }
  return items;
}

// Maestro: a .maestro folder, or YAML flows that start with appId.
function maestroStack(root: string): StackItem[] {
  const flows = walk(root, (rel) => /\.ya?ml$/.test(rel) && !rel.startsWith('.github'))
    .filter((rel) => rel.startsWith('.maestro/') || /^\s*appId\s*:/m.test(read(path.join(root, rel)).split(/^---\s*$/m)[0] ?? ''));
  if (!flows.length) return [];
  const folder = flows.every((f) => f.startsWith('.maestro/')) ? '.maestro' : path.dirname(flows[0]);
  return [{ id: 'maestro', label: 'Maestro', kind: 'mobile', foundIn: flows[0], detail: `${flows.length} flow${flows.length === 1 ? '' : 's'} in ${folder}` }];
}

function k6Stack(root: string): StackItem[] {
  const scripts = walk(root, (rel) => /\.(js|ts)$/.test(rel) && !rel.includes('node_modules')).filter((rel) => /from\s+['"]k6(\/[\w/]+)?['"]/.test(read(path.join(root, rel)).slice(0, 2000)));
  return scripts.length ? [{ id: 'k6', label: 'k6 load tests', kind: 'load', foundIn: scripts[0], detail: scripts.length > 1 ? `${scripts.length} scripts` : undefined }] : [];
}

const CI_TEST = /\b(npm (?:run )?test|npm run [\w:-]*(?:test|e2e)[\w:-]*|npx (?:vitest|jest|playwright test|cypress run)|yarn test|pnpm test|pytest|tox|go test|cargo test|xcodebuild[^\n]*test|gradlew?[^\n]*test|maestro test|k6 run|detox test)\b[^\n'"]*/;

// CI files that run tests, with the first test command each one runs.
function ciStack(root: string): StackItem[] {
  const files = [
    ...list(path.join(root, '.github', 'workflows')).filter((e) => /\.ya?ml$/.test(e.name)).map((e) => path.join('.github', 'workflows', e.name)),
    ...['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', 'Jenkinsfile'].filter((f) => exists(path.join(root, f))),
  ];
  return files.flatMap((rel) => {
    const command = CI_TEST.exec(read(path.join(root, rel)))?.[0]?.trim();
    return command ? [{ id: `ci:${rel}`, label: 'CI', kind: 'ci' as const, foundIn: rel, detail: `runs ${command}` }] : [];
  });
}

export function detectStack(root: string): StackItem[] {
  return [...nodeStack(root), ...pythonStack(root), ...goStack(root), ...nativeStack(root), ...maestroStack(root), ...k6Stack(root), ...ciStack(root)];
}

// Skills, agents and commands about testing software, from the "/" menu's catalog. Only the description is scored.

// Count on their own.
const STRONG_SIGNALS: RegExp[] = [
  /\b(qa|e2e|tdd|regressions?|flaky)\b/,
  /\bend-to-end (tests?|testing|suite)\b/,
  /\b(test|code) coverage\b/,
  /\b(unit|integration|smoke|snapshot)[- ](tests?|testing)\b/,
  /\btest (suites?|runners?)\b/,
  /\bfailing tests?\b/,
  /\b(playwright|maestro|cypress|vitest|jest|pytest|detox)\b/,
  /\b(prove|proves|proof)\b(\W+\w+){0,4}?\W+(works|landed)\b/,
];

// Count only with a software word close by.
const WEAK_WORDS = new Set(['test', 'tests', 'testing', 'tested', 'verify', 'verifies', 'verification', 'spec', 'specs', 'check', 'checks', 'checking']);
const SOFTWARE_WORDS = new Set([
  'code', 'app', 'apps', 'build', 'builds', 'ui', 'api', 'apis', 'endpoint', 'endpoints', 'diff',
  'deploy', 'deployed', 'staging', 'component', 'components', 'function', 'functions', 'bug', 'bugs', 'fix', 'fixes',
  'landed', 'browser', 'mobile', 'ci',
]);
const NEARBY_WORDS = 6;

// Without any software word, these mean a piece of writing is being checked.
const WRITING_WORDS = new Set(['piece', 'reader', 'readers', 'audience', 'hook', 'hooks', 'headline', 'headlines', 'copy', 'copywriting', 'cta', 'post', 'brand']);

// Idioms that say "test" without meaning software; removed before scoring. unit-test and friends stay.
const SOFTWARE_TEST_KINDS = ['unit', 'integration', 'e2e', 'smoke', 'snapshot', 'regression', 'load'];
const NOT_SOFTWARE_TESTING: RegExp[] = [
  new RegExp(`\\b(?!(?:${SOFTWARE_TEST_KINDS.join('|')})-)[\\w/]+-test(s|ed|ing)?\\b`, 'g'), // mom-test, stress-test, a/b-test
  /\ba\/?b (tests?|testing)\b/g,
  /\btest (the |a |an |your )?(hook|idea|headline|audience|copy|message|pitch|offer)s?\b/g,
  /\btest(s|ed|ing)? (it )?against (a |the )?(non-expert )?readers?\b/g,
];

export function isAboutTestingSoftware(description: string): boolean {
  const text = NOT_SOFTWARE_TESTING.reduce((t, idiom) => t.replace(idiom, ' '), description.toLowerCase());
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const isSoftware = (w: string) => SOFTWARE_WORDS.has(w);
  if (!words.some(isSoftware) && words.some((w) => WRITING_WORDS.has(w))) return false;
  if (STRONG_SIGNALS.some((signal) => signal.test(text))) return true;
  return words.some((w, i) => WEAK_WORDS.has(w) && words.slice(Math.max(0, i - NEARBY_WORDS), i + NEARBY_WORDS + 1).some(isSoftware));
}

export function testingSkills(items: SlashItem[]): StackItem[] {
  return items
    .filter((i) => i.kind !== 'builtin' && isAboutTestingSoftware(i.description))
    .map((i) => ({ id: `${i.kind}:${i.source}:${i.name}`, label: i.name, kind: i.kind as StackItem['kind'], foundIn: `${i.source} ${i.kind}s`, detail: i.description, insert: i.insert }));
}

// The stages detection proposes, in pipeline order, with the commands the project already uses.
export function proposeStages(root: string, stack: StackItem[]): StageConfig[] {
  const scripts = scriptsOf(root);
  const has = (id: string) => stack.some((s) => s.id === id);
  const pm = exists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : exists(path.join(root, 'yarn.lock')) ? 'yarn' : exists(path.join(root, 'bun.lockb')) ? 'bun' : 'npm';
  const run = (name: string) => (name === 'test' && pm !== 'bun' ? `${pm} test` : `${pm} run ${name}`);
  const script = (...names: string[]) => names.find((n) => scripts[n] !== undefined) ?? null;
  const stages: { name: string; command: string }[] = [];
  const add = (name: string, command: string | null) => { if (command && !stages.some((s) => s.command === command)) stages.push({ name, command }); };

  const typecheck = script('typecheck', 'type-check', 'tsc', 'check-types');
  add('Typecheck', typecheck && run(typecheck));
  const lint = script('lint');
  add('Lint', lint && run(lint));

  const testScript = scripts.test && !/no test specified/.test(scripts.test) ? 'test' : script('test:unit', 'unit');
  const unitRunner = ['vitest', 'jest', 'mocha'].find(has);
  if (testScript) add('Unit', run(testScript));
  else if (unitRunner === 'vitest') add('Unit', 'npx vitest run');
  else if (unitRunner === 'jest') add('Unit', 'npx jest');
  else if (unitRunner === 'mocha') add('Unit', 'npx mocha');
  if (has('pytest')) add(stages.some((s) => s.name === 'Unit') ? 'Python' : 'Unit', 'pytest');
  if (has('go')) add(stages.some((s) => s.name === 'Unit') ? 'Go' : 'Unit', 'go test ./...');
  if (has('cargo')) add(stages.some((s) => s.name === 'Unit') ? 'Rust' : 'Unit', 'cargo test');
  if (has('swift')) add('Unit', 'swift test');
  const xcode = stack.find((s) => s.id === 'xcodebuild');
  if (xcode) add('XCTest', `xcodebuild test -scheme ${xcode.foundIn.replace(/\.(xcworkspace|xcodeproj)$/, '')}`);
  if (has('gradle')) add('Unit', exists(path.join(root, 'gradlew')) ? './gradlew test' : 'gradle test');

  const integration = script('test:integration', 'integration', 'test:int');
  if (integration) add('Integration', run(integration));
  else if (exists(path.join(root, 'tests', 'integration')) && has('pytest')) add('Integration', 'pytest tests/integration');

  const e2e = script('test:e2e', 'e2e');
  if (e2e) add('E2E', run(e2e));
  else if (has('playwright')) add('E2E', 'npx playwright test');
  else if (has('cypress')) add('E2E', 'npx cypress run');
  if (has('detox')) add('Mobile', 'npx detox test');

  const maestro = stack.find((s) => s.id === 'maestro');
  if (maestro) add('Mobile flows', `maestro test ${maestro.detail?.split(' in ')[1] ?? '.maestro'}`);
  const k6 = stack.find((s) => s.id === 'k6');
  if (k6) add('Load', `k6 run ${k6.foundIn}`);

  const taken: string[] = [];
  return stages.map((s) => { const id = slugId(s.name, taken); taken.push(id); return { id, ...s }; });
}
