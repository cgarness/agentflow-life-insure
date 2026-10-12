// Compare two csv-capture.mjs outputs byte for byte. No normalization of any kind: every entry must exist on both
// sides with the same raw SHA-256. Differences are printed line by line so a reviewer can see exactly what moved.
// Every saved file is re-hashed and must match its manifest entry, so neither a file nor a manifest can be edited
// on its own without failing the comparison.
//   node compare-csv-captures.mjs <baseOutput> <candidateOutput>
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [baseDir, candDir] = process.argv.slice(2);
if (!baseDir || !candDir) { console.error('usage: compare-csv-captures.mjs <base> <candidate>'); process.exit(2); }
const load = async dir => JSON.parse(await readFile(`${dir}/manifest.json`, 'utf8'));
const base = await load(baseDir), cand = await load(candDir);
const index = m => new Map(m.entries.map(e => [e.key, e]));
const b = index(base), c = index(cand);
let identical = 0, different = 0, missing = 0, added = 0, unavailableMismatch = 0, bytes = 0, corrupt = 0;
const sha = buf => createHash('sha256').update(buf).digest('hex');
for (const [dir, m] of [[baseDir, base], [candDir, cand]]) for (const e of m.entries) {
  if (!e.sha256) continue;
  const buf = await readFile(`${dir}/csv/${e.saved}`).catch(() => null);
  if (!buf || sha(buf) !== e.sha256 || buf.length !== e.bytes) { corrupt++; console.log('FILE DOES NOT MATCH MANIFEST:', dir, e.key); }
}
for (const [key, be] of b) {
  const ce = c.get(key);
  if (!ce) { missing++; console.log('MISSING in candidate:', key); continue; }
  if (!be.sha256 || !ce.sha256) {
    if (be.unavailable !== ce.unavailable) { unavailableMismatch++; console.log('UNAVAILABLE differs:', key, be.unavailable, '|', ce.unavailable); }
    continue;
  }
  if (be.sha256 === ce.sha256 && be.suggestedFilename === ce.suggestedFilename) { identical++; bytes += be.bytes; continue; }
  different++;
  console.log('DIFFERENT:', key, be.suggestedFilename, ce.suggestedFilename);
  const bl = (await readFile(`${baseDir}/csv/${be.saved}`, 'utf8')).split('\n');
  const cl = (await readFile(`${candDir}/csv/${ce.saved}`, 'utf8')).split('\n');
  for (let i = 0; i < Math.max(bl.length, cl.length); i++) if (bl[i] !== cl[i]) console.log(`  line ${i + 1}\n    base: ${bl[i]}\n    cand: ${cl[i]}`);
}
for (const key of c.keys()) if (!b.has(key)) { added++; console.log('ADDED in candidate:', key); }
const downloads = [...b.values()].filter(e => e.sha256).length;
console.log(JSON.stringify({ base: { url: base.url, fixedClock: base.fixedClock }, candidate: { url: cand.url, fixedClock: cand.fixedClock },
  downloads, identical, different, missing, added, unavailableMismatch, corrupt, identicalBytes: bytes }));
process.exit(different || missing || added || unavailableMismatch || corrupt || base.fixedClock !== cand.fixedClock ? 1 : 0);
