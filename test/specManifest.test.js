// test/fixtures holds byte-identical copies of pox-smart-contract-litvm's
// spec/result-v5.json and spec/MANIFEST.sha256 (the SHA-256 of every spec
// fixture in the sha256sum text format, LF lines). Each copy must hash to its
// manifest line and, where a litvm checkout is reachable
// (POX_SMART_CONTRACT_LITVM, else the sibling ../pox-smart-contract-litvm),
// the copies and the manifest must equal the source bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const MANIFEST = 'MANIFEST.sha256';
const COPIES = ['result-v5.json'];
const LITVM_ENV = 'POX_SMART_CONTRACT_LITVM';
const LITVM_DEFAULT = path.join(FIXTURES, '..', '..', '..', 'pox-smart-contract-litvm');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const manifestEntries = () => {
  const text = readFileSync(path.join(FIXTURES, MANIFEST), 'latin1');
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

test('the manifest is LF-terminated sha256sum text naming every copy', () => {
  const entries = manifestEntries();
  const names = Object.keys(entries);
  assert.deepEqual(names, [...names].sort(), 'manifest names are not in bytewise order');
  for (const name of COPIES) {
    assert.ok(entries[name], `${name} is not in the manifest`);
  }
});

test('every fixture copy hashes to its manifest line', () => {
  const entries = manifestEntries();
  for (const name of COPIES) {
    assert.equal(sha256(readFileSync(path.join(FIXTURES, name))), entries[name], `${name} does not hash to the manifest`);
  }
});

test('the copies equal the litvm spec bytes when a checkout is reachable', (t) => {
  const spec = path.join(path.resolve(process.env[LITVM_ENV] || LITVM_DEFAULT), 'spec');
  if (!existsSync(path.join(spec, MANIFEST))) {
    t.skip(`no pox-smart-contract-litvm checkout at ${spec} (set ${LITVM_ENV})`);
    return;
  }
  for (const name of [MANIFEST, ...COPIES]) {
    const ours = readFileSync(path.join(FIXTURES, name));
    const theirs = readFileSync(path.join(spec, name));
    assert.ok(ours.equals(theirs), `test/fixtures/${name} differs from ${path.join(spec, name)}`);
  }
});
