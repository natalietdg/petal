// One-off: copies each checkout's old in-repo .petal/ into ~/.petal/repos/<repoKey>/, the same import Petal runs on a
// repo's first read, without the app. Never changes or deletes the repo's folder. Byte-checks every copy.
// Usage: node scripts/import-repo-petal.ts [--home <dir>] <checkout>...   (Node 22: types stripped)
// Exit code 1 when any copy differs from its original or a checkout isn't a folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adoptRepoPetal, verifyAdopted } from '../src/main/petal-repos.ts';

const args = process.argv.slice(2);
const homeAt = args.indexOf('--home');
const home = homeAt >= 0 ? path.resolve(args[homeAt + 1] ?? '') : os.homedir();
const checkouts = args.filter((_, i) => homeAt < 0 || (i !== homeAt && i !== homeAt + 1));
if (!checkouts.length) {
  console.error('Usage: node scripts/import-repo-petal.ts [--home <dir>] <checkout>...');
  process.exit(2);
}

let failed = false;
for (const raw of checkouts) {
  const checkout = path.resolve(raw.replace(/^~(?=\/|$)/, os.homedir()));
  if (!fs.existsSync(checkout) || !fs.statSync(checkout).isDirectory()) { console.log(`MISSING  ${checkout}`); failed = true; continue; }
  const result = adoptRepoPetal(checkout, home);
  console.log(`\n${checkout}\n  -> ${result.to}`);
  if (result.already) { console.log('  already imported earlier (marker present): nothing copied'); continue; }
  if (!result.copied.length && !result.kept.length && !result.skipped.length) { console.log('  no .petal folder'); continue; }
  for (const c of result.copied) console.log(`  copied   ${c.rel} (${c.bytes} bytes)`);
  for (const k of result.kept) console.log(`  kept     ${k.rel} (Petal already had it; ${k.same ? 'byte-equal' : 'DIFFERENT from the repo copy'})`);
  for (const s of result.skipped) console.log(`  skipped  ${s.rel}: ${s.why}`);
  const mismatched = verifyAdopted(result);
  if (mismatched.length || result.kept.some((k) => !k.same)) failed = true;
  console.log(mismatched.length ? `  VERIFY FAILED: ${mismatched.join(', ')}` : `  verified: ${result.copied.length} copies byte-equal`);
}
process.exit(failed ? 1 : 0);
