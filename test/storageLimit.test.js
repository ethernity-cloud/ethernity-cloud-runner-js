// INTAKE_MAX_BYTES: a blob above what the intake takes is not sent to it; it
// is held in the runner's held cache, uploadToIPFS and uploadArtefact throw
// StorageLimitError naming the cache and the remedy, the held blobs go out
// through the IPFS API once initialize() sets one, and releaseHeld forgets
// them once a transaction names them. A loopback server stands in for the
// API; the cache is the file store in a directory of its own.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initialize, initializeIntake, uploadToIPFS, uploadArtefact, uploadHeld, heldBlobs, heldEntry, heldBlob, releaseHeld,
  cidv1Raw, INTAKE_MAX_BYTES, StorageLimitError
} from '../ipfs.js';
import { configureHeldCache } from '../heldCache.js';

const requests = [];
let base = '';
let directory = '';
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  requests.push({ url: req.url, body });
  // Kubo's add answer for bytes added without a path: Name and Hash are the
  // CID the bytes have, read out of the multipart body (the file part is its
  // last line before the closing boundary).
  const parts = body.toString('latin1').split('\r\n');
  const content = parts[parts.length - 3] ?? '';
  const cid = cidv1Raw(Buffer.from(content, 'latin1'));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(`${JSON.stringify({ Name: cid, Hash: cid, Size: String(content.length) })}\n`);
});

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'etny-held-'));
  configureHeldCache({ directory });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => { server.close(resolve); });
  await rm(directory, { recursive: true, force: true });
});

beforeEach(() => { requests.length = 0; });

const bytesOf = (text) => new TextEncoder().encode(text);

test('the public limit is the intake\'s 100 MiB', () => {
  assert.equal(INTAKE_MAX_BYTES, 100 * 1024 * 1024);
});

test('a blob above the limit is held in the cache, not queued, and the error names the cache and the remedy', async () => {
  initializeIntake('bloxberg_testnet', base, 16);
  const small = 'x'.repeat(16);
  const large = 'y'.repeat(17);
  assert.equal(await uploadToIPFS(small), cidv1Raw(bytesOf(small)));
  const error = await uploadToIPFS(large).catch((e) => e);
  assert.ok(error instanceof StorageLimitError, `expected StorageLimitError, got ${error}`);
  assert.equal(error.cid, cidv1Raw(bytesOf(large)));
  assert.equal(error.size, 17);
  assert.equal(error.limit, 16);
  assert.match(error.message, /up to 16 bytes and this one is 17 bytes/);
  assert.match(error.message, new RegExp(`held in .*${directory.replace(/\\/g, '\\\\')}`));
  assert.match(error.message, /initializeStorage\(url, token\)/);
  assert.deepEqual((await heldBlobs()).filter((b) => b.cid === error.cid), [{ cid: error.cid, size: 17, uploaded: false }]);
  const held = await heldBlob(error.cid);
  assert.equal(typeof held.text === 'function' ? await held.text() : new TextDecoder().decode(held), large);
  assert.equal(requests.length, 0);
});

test('an artefact is held under its key with its digest, uploaded when an API is set, and released when named', async () => {
  initializeIntake('bloxberg_testnet', base, 16);
  const large = 'z'.repeat(20);
  const key = 'plaintext-hash|enclave-key-hash';
  const error = await uploadArtefact(large, key).catch((e) => e);
  assert.ok(error instanceof StorageLimitError);
  const entry = await heldEntry(key);
  assert.equal(entry.cid, error.cid);
  assert.equal(entry.size, 20);
  assert.equal(entry.digest.length, 64);
  assert.equal(entry.uploaded, false);
  assert.deepEqual(await uploadHeld(), { uploaded: [], failed: {} }); // the intake takes none
  initialize(base);
  const outcome = await uploadHeld();
  assert.deepEqual(outcome.failed, {});
  assert.ok(outcome.uploaded.includes(error.cid), 'the held blob was uploaded');
  assert.ok(requests.some((r) => r.url.startsWith('/api/v0/add')), 'the API received the add');
  assert.equal((await heldEntry(key)).uploaded, true, 'the entry stays, marked uploaded, until released');
  await releaseHeld([error.cid]);
  assert.equal(await heldEntry(key), null);
  assert.deepEqual((await heldBlobs()).filter((b) => b.cid === error.cid), []);
});
