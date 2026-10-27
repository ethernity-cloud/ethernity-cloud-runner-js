// INTAKE_MAX_BYTES: a blob above what the intake takes is not sent to it; it
// is held in the runner's local cache, uploadToIPFS throws StorageLimitError
// naming the cache and the remedy, and the held blobs go out through the IPFS
// API once initialize() sets one. A loopback server stands in for the API.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  initialize, initializeIntake, uploadToIPFS, uploadHeld, heldBlobs, cidv1Raw, INTAKE_MAX_BYTES, StorageLimitError
} from '../ipfs.js';

const requests = [];
let base = '';
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
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => { server.close(resolve); });
});

beforeEach(() => { requests.length = 0; });

test('the public limit is the intake\'s 100 MiB', () => {
  assert.equal(INTAKE_MAX_BYTES, 100 * 1024 * 1024);
});

test('a blob above the limit is held, not queued, and the error names the cache and the remedy', async () => {
  initializeIntake('bloxberg_testnet', base, 16);
  const small = 'x'.repeat(16);
  const large = 'y'.repeat(17);
  assert.equal(await uploadToIPFS(small), cidv1Raw(new TextEncoder().encode(small)));
  const error = await uploadToIPFS(large).catch((e) => e);
  assert.ok(error instanceof StorageLimitError, `expected StorageLimitError, got ${error}`);
  assert.equal(error.cid, cidv1Raw(new TextEncoder().encode(large)));
  assert.equal(error.size, 17);
  assert.equal(error.limit, 16);
  assert.match(error.message, /up to 16 bytes and this one is 17 bytes/);
  assert.match(error.message, /held in the runner's local cache/);
  assert.match(error.message, /initializeStorage\(url, token\)/);
  assert.deepEqual(heldBlobs(), [{ cid: error.cid, size: 17 }]);
  assert.equal(requests.length, 0);
});

test('the held blobs are uploaded once an IPFS API of the application\'s own is set', async () => {
  initializeIntake('bloxberg_testnet', base, 16);
  const large = 'z'.repeat(20);
  const error = await uploadToIPFS(large).catch((e) => e);
  assert.ok(error instanceof StorageLimitError);
  assert.deepEqual(await uploadHeld(), { uploaded: [], failed: {} }); // the intake takes none
  initialize(base);
  const outcome = await uploadHeld();
  assert.deepEqual(outcome.failed, {});
  assert.ok(outcome.uploaded.includes(error.cid), 'the held blob was uploaded');
  assert.equal(heldBlobs().filter((b) => b.cid === error.cid).length, 0);
  assert.ok(requests.some((r) => r.url.startsWith('/api/v0/add')), 'the API received the add');
});
