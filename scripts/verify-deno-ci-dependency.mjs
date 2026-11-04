// npm ci authenticates the package tarball through package-lock.json integrity.
// CI uses its original ESM module instead of the regionally inconsistent CDN build.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const pkg = JSON.parse(readFileSync(new URL('../node_modules/tslib/package.json', import.meta.url), 'utf8'));
assert.equal(pkg.version, '2.8.1', 'Review the CI import map when updating tslib');
assert.ok(readFileSync(new URL('../node_modules/tslib/tslib.es6.mjs', import.meta.url)).length > 0);
console.log('Deno CI dependency: npm-locked tslib 2.8.1');
