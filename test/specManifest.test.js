// test/fixtures holds byte-identical copies of pox-smart-contract-litvm's
// spec/ files at specCopies.SOURCE_COMMIT and one MANIFEST.sha256 holding
// that commit's line of each copy, in name order (the sha256sum text format,
// LF lines), so that `sha256sum -c MANIFEST.sha256` there checks every copy.
// Each copy must hash to its line, and, where a checkout is found
// (specCopies.checkout), each copy and each line must equal the source
// commit's, read with `git show`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COPIES, MANIFEST, SOURCE_COMMIT, SPEC, checkout, shownAt } from './specCopies.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const manifestEntries = () => {
  const text = readFileSync(path.join(SPEC, MANIFEST), 'latin1');
  assert.ok(!text.includes('\r'), 'manifest holds a CR');
  assert.ok(text.endsWith('\n'), 'manifest does not end with LF');
  const entries = {};
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const m = /^([0-9a-f]{64})  (\S+)$/.exec(line);
    assert.ok(m, `manifest line is not "<sha256>  <name>": ${JSON.stringify(line)}`);
    entries[m[2]] = m[1];
  }
  return entries;
};

test('the manifest names every copy the directory holds, in name order', () => {
  const names = Object.keys(manifestEntries());
  assert.deepEqual(names, [...names].sort());
  assert.deepEqual(names, COPIES);
  assert.deepEqual(readdirSync(SPEC).filter((n) => n !== MANIFEST).sort(), COPIES);
});

const sourceOrSkip = (t, file) => {
  const found = shownAt(file);
  if (found === null) t.skip(`no pox-smart-contract-litvm checkout holding ${SOURCE_COMMIT} (found: ${checkout()})`);
  return found;
};

for (const name of COPIES) {
  test(`${name} hashes to its manifest line`, () => {
    assert.equal(sha256(readFileSync(path.join(SPEC, name))), manifestEntries()[name]);
  });

  test(`${name} is the source commit's`, (t) => {
    const source = sourceOrSkip(t, `spec/${name}`);
    if (source === null) return;
    assert.ok(readFileSync(path.join(SPEC, name)).equals(source));
  });
}

test('the manifest lines are the source commit\'s', (t) => {
  const source = sourceOrSkip(t, `spec/${MANIFEST}`);
  if (source === null) return;
  const lines = Object.fromEntries(source.toString('ascii').split('\n').filter(Boolean).map((l) => l.split('  ').reverse()));
  assert.deepEqual(Object.fromEntries(COPIES.map((n) => [n, lines[n]])), manifestEntries());
});

test('the checkout is found by its variable before any parent', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'litvm-'));
  assert.equal(checkout(dir, { POX_SMART_CONTRACT_LITVM: dir }), null);
  mkdirSync(path.join(dir, '.git'));
  assert.equal(checkout(path.join(dir, 'repo'), { POX_SMART_CONTRACT_LITVM: dir }), path.resolve(dir));
});

test('without the variable the checkout beside a directory above the repository is found', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'litvm-'));
  const repo = path.join(dir, 'ec-runner-js', 'packages', 'ethernity-cloud-runner-js');
  mkdirSync(repo, { recursive: true });
  mkdirSync(path.join(dir, 'pox-smart-contract-litvm', '.git'), { recursive: true });
  assert.equal(checkout(repo, {}), path.join(dir, 'pox-smart-contract-litvm'));
});
