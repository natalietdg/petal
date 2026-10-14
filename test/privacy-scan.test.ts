// scripts/privacy-scan.sh against small fake Petal.app bundles: the word ban, the allowed feed host, and Resources text files.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir } from './helpers';

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'privacy-scan.sh');
const ASAR = path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');

function fakeApp(appFiles: Record<string, string>, resourceFiles: Record<string, string> = {}): string {
  const root = tempDir('petal-scan-');
  const src = path.join(root, 'src');
  for (const [file, text] of Object.entries(appFiles)) {
    fs.mkdirSync(path.dirname(path.join(src, file)), { recursive: true });
    fs.writeFileSync(path.join(src, file), text);
  }
  const resources = path.join(root, 'Petal.app', 'Contents', 'Resources');
  fs.mkdirSync(resources, { recursive: true });
  spawnSync(process.execPath, [ASAR, 'pack', src, path.join(resources, 'app.asar')], { encoding: 'utf8' });
  for (const [file, text] of Object.entries(resourceFiles)) {
    fs.mkdirSync(path.dirname(path.join(resources, file)), { recursive: true });
    fs.writeFileSync(path.join(resources, file), text);
  }
  return path.join(root, 'Petal.app');
}

const scan = (app: string) => spawnSync('/bin/zsh', [SCRIPT, app, 'fake'], { cwd: ROOT, encoding: 'utf8' });

describe('privacy-scan.sh', () => {
  afterEach(removeTempDirs);

  it('passes a clean bundle that names the update feed host', () => {
    const app = fakeApp({ 'out/main/index.js': 'const feed = "https://petal.natalieleong19.workers.dev";' }, { 'app-update.yml': 'url: https://petal.natalieleong19.workers.dev\n' });
    const result = scan(app);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails on the word natalie in any case inside app.asar', () => {
    const result = scan(fakeApp({ 'out/renderer/index.js': 'label: "Natalie (approval gate)"' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('contains "natalie"');
    expect(result.stderr).toContain('app/out/renderer/index.js');
  });

  it('does not flag natalie inside a longer word', () => {
    expect(scan(fakeApp({ 'out/main/index.js': 'const nataliex = 1;' })).status).toBe(0);
  });

  it('scans Resources text files beside app.asar', () => {
    const result = scan(fakeApp({ 'out/main/index.js': 'ok' }, { 'output-styles/style.md': 'Ask Natalie first.\n', 'extra.json': '{"path":"/Users/someone"}' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('resources/output-styles/style.md');
    expect(result.stderr).toContain('resources/extra.json');
  });
});
