#!/usr/bin/env node
// Assemble reviewable packages from read-only Supabase get_edge_function captures.
// This command has no network, credentials, database client, or deploy operation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sortedFiles = (files) => [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const fileHashes = (files) => sortedFiles(files).map(([name, content]) => ({ path: name, sha256: hash(content) }));
const baseline = {
  'twilio-search-numbers': [58, '33920b99b6540188edffac817be29353ac2b48a901554899c33993d8c1557cb4', '736d95a8bb2992ceb92a31d2f94f46b4450d9c4a8c6f0f4240f8a2ee9c6f7aea'],
  'twilio-buy-number': [64, 'c0f6c5eff622f84735509518738cab76bfcbd9b89a3fcc6e7ab609a8226d133b', 'd890aa62e7498872ed5f8fa52a0b737960c27c5fa94e02388deef4c83160deed'],
  'twilio-sms': [60, '1b14b60ab76da612ef6a2813955d6b44d57c3c4b8d3bb98d2beab76bfab90a3e', 'a4716c8fa29f2cadb0e78f0a3e0523686a1e22a3c410909d4e4be6b5ef61104d'],
  'workflow-executor': [49, '988085f79a952246e03b7407840ebfa41d26353802d109a0a697a4fc536d56da', '282430b5ec14ad63dde7c260e30b45af000809b3f963375309f9370e6f0d1d9f'],
  'sms-consent-worker': [25, 'ac8c8d59d5bd24bf5ba19c732fecc00df3b3cc36c1e8b1bb445d54a77dcfdb4f', '399e0dd6cafb9cd67f25000fec700945df36a7e220aec1ba1926aa4174a950ca'],
  'clearpath-lead-alert': [24, 'dc8160abea2dbf5ceab2dd744fb47986828ddaa118a08ab0838e54c935f646dd', '92fd7deb3618716e31e8c978d3e9d7bf591419cfceebc624cad4b4eb75b345bf'],
};
const shared = 'supabase/functions/_shared/';
const additions = new Set([
  ...['contracts', 'auth', 'inventory', 'pricing', 'purchase'].map((name) => `${shared}phoneNumbers/${name}.ts`),
  `${shared}twilioOutboundCreds.ts`, `${shared}twilioSubaccountCreds.ts`, `${shared}twilioNumberConfig.ts`,
]);
const migration = 'supabase/migrations/20261104041151_phone_number_purchase_operations.sql';
const frontend = [
  ...['NumberManagementSection.tsx', 'numberSearchSchema.ts', 'NumberPurchaseDialog.tsx', 'NumberPurchaseResults.tsx',
    'NumberPurchaseReview.tsx', 'useNumberPurchase.ts'].map((name) => `src/components/settings/phone/${name}`),
  'src/lib/phone-number-purchase.ts',
  'src/lib/caller-id-selection.ts',
];

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/prepare-phone-number-release.mjs --live-dir CAPTURES --out-dir EMPTY_DIRECTORY [--manifest FILE]');
  console.log('Requires six unchanged, freshly rechecked live JSON captures. Produces complete packages for review; never deploys.');
  process.exit(0);
}
const options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--live-dir', '--out-dir', '--manifest'].includes(args[i]) && args[i + 1], 'Unknown or incomplete argument. Use --help.');
  assert(!options[args[i]], 'Duplicate argument.');
  options[args[i]] = path.resolve(args[i + 1]);
}
assert(options['--live-dir'] && options['--out-dir'], 'Both --live-dir and --out-dir are required.');
const out = options['--out-dir'];
assert(out !== root && !out.startsWith(root + path.sep), 'Full captured bundles must stay outside the source checkout.');
await fs.mkdir(out, { recursive: true });
assert.equal((await fs.readdir(out)).length, 0, 'Output directory must be empty; do not overwrite a reviewed release.');

function normalize(name) {
  assert.equal(typeof name, 'string', 'Missing source filename.');
  const match = name.match(/(?:^|\/)functions\/(.+)$/);
  assert(match && !match[1].split('/').some((part) => !part || part === '.' || part === '..'), 'Unsafe source filename.');
  assert(!name.includes('\\'), 'Backslash source paths are unsupported.');
  return 'supabase/functions/' + match[1];
}
function dependencies(name, content) {
  const found = [];
  // These deployed TypeScript packages use static import/export-from and import().
  for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)) {
    if (!match[1].startsWith('.')) continue;
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
    assert(dependency.startsWith('supabase/functions/'), 'Import escapes the reviewed function tree.');
    found.push(dependency);
  }
  return found;
}

// Validate every capture and dependency before writing any package.
const packages = [];
for (const [slug, [version, bundleHash, sourceHash]] of Object.entries(baseline)) {
  const live = JSON.parse(await fs.readFile(path.join(options['--live-dir'], `${slug}.json`), 'utf8'));
  assert.equal(live.slug, slug, `${slug}: wrong capture`);
  assert.equal(live.version, version, `${slug}: live version drift; stop and review`);
  assert.equal(live.ezbr_sha256, bundleHash, `${slug}: live bundle drift; stop and review`);
  assert.equal(live.status, 'ACTIVE', `${slug}: live status changed`);
  assert.equal(live.verify_jwt, false, `${slug}: preserve reviewed verify_jwt`);
  assert.equal(live.import_map, false, `${slug}: import map changed`);
  const original = new Map();
  for (const file of live.files) {
    const name = normalize(file.name);
    assert(!original.has(name) && typeof file.content === 'string', `${slug}: duplicate or invalid file`);
    original.set(name, file.content);
  }
  assert.equal(hash(JSON.stringify(fileHashes(original))), sourceHash, `${slug}: captured source bytes changed`);
  const entrypoint = `supabase/functions/${slug}/index.ts`;
  assert.equal(normalize(live.entrypoint_path), entrypoint, `${slug}: entrypoint changed`);
  const replacements = [slug === 'twilio-search-numbers' || slug === 'twilio-buy-number'
    ? entrypoint : `${shared}a2p/sending.ts`];
  const files = new Map(original);
  for (const name of replacements) {
    assert(original.has(name), `${slug}: replacement did not exist in the live baseline`);
    files.set(name, await fs.readFile(path.join(root, name), 'utf8'));
  }
  const queue = [...files.keys()];
  for (let i = 0; i < queue.length; i++) {
    for (const name of dependencies(queue[i], files.get(queue[i]))) {
      if (files.has(name)) continue;
      assert((slug === 'twilio-search-numbers' || slug === 'twilio-buy-number') && additions.has(name),
        `${slug}: unapproved added dependency ${name}`);
      if (name === `${shared}twilioNumberConfig.ts`) {
        // Quote and purchase share a module. Its config dependency must use the
        // reviewed purchasing configuration even in the non-purchasing bundle.
        const buy = JSON.parse(await fs.readFile(path.join(options['--live-dir'], 'twilio-buy-number.json'), 'utf8'));
        const content = buy.files.find((file) => normalize(file.name) === name)?.content;
        assert.equal(hash(content ?? ''), 'b5f1804e0af82d5556cc37746a54b00c812c9636bc13bda24b65fbca488fd27e');
        files.set(name, content);
      } else files.set(name, await fs.readFile(path.join(root, name), 'utf8'));
      queue.push(name);
    }
  }
  for (const [name, content] of original) {
    if (!replacements.includes(name)) assert.equal(files.get(name), content, `${slug}: unrelated live source changed`);
  }
  const payload = {
    name: slug, entrypoint_path: entrypoint, verify_jwt: false,
    files: sortedFiles(files).map(([name, content]) => ({ name, content })),
  };
  const serialized = JSON.stringify(payload, null, 2) + '\n';
  packages.push({ slug, files, serialized, manifest: {
    function: slug, baseline_version: version, baseline_ezbr_sha256: bundleHash,
    baseline_source_sha256: sourceHash, entrypoint_path: entrypoint, verify_jwt: false, import_map: false,
    payload_sha256: hash(serialized), payload_path: `${slug}/payload.json`,
    files: fileHashes(files).map((file) => ({ ...file,
      action: !original.has(file.path) ? 'added' : replacements.includes(file.path) ? 'replaced' : 'preserved',
      baseline_sha256: original.has(file.path) ? hash(original.get(file.path)) : null,
    })),
  } });
}
const manifest = {
  feature: 'US toll-free number purchasing', status: 'prepared_for_review_not_deployed',
  reviewed_main: '0e74428259275c9281518832747a627a4f635a80',
  production_project: 'jncvvsvckxhqgqvkppmj',
  migration: { path: migration, sha256: hash(await fs.readFile(path.join(root, migration))) },
  frontend: await Promise.all(frontend.map(async (name) => ({ path: name, sha256: hash(await fs.readFile(path.join(root, name))) }))),
  release_order: ['exact migration approval', 'four SMS guard packages', 'search and purchase packages', 'frontend release'],
  gates: ['Refresh live captures and compare exact baselines immediately before release.',
    'Approve database, six full Edge packages, and frontend release separately.',
    'Any real purchase, room assignment, call or SMS requires separate transaction authorization.'],
  packages: packages.map((item) => item.manifest),
};
for (const item of packages) {
  for (const [name, content] of item.files) {
    const destination = path.join(out, item.slug, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, { flag: 'wx' });
  }
  await fs.writeFile(path.join(out, item.slug, 'payload.json'), item.serialized, { flag: 'wx' });
}
const manifestText = JSON.stringify(manifest, null, 2) + '\n';
await fs.writeFile(path.join(out, 'release-manifest.json'), manifestText, { flag: 'wx' });
if (options['--manifest']) await fs.writeFile(options['--manifest'], manifestText);
console.log(`Prepared ${packages.length} complete function packages; every unrelated live file is byte-for-byte preserved.`);
console.log(`Manifest: ${path.join(out, 'release-manifest.json')}`);
console.log('No network request, deployment, database change or number purchase was performed.');
