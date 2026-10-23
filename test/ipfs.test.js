import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { initialize, initializeIntake, uploadToIPFS, flushPending, cidv1Raw, RAW_BLOCK_MAX } from '../ipfs.js';

// A loopback HTTP server standing in for a Kubo RPC API and for the intake:
// every request it receives is recorded, and `answer` decides the reply.
const requests = [];
let answer = () => ({ status: 200, body: '' });
let base = '';
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
  const reply = answer();
  res.writeHead(reply.status, reply.headers || { 'Content-Type': 'text/plain' });
  res.end(reply.body);
});

const addAnswer = (cid) => ({
  status: 200,
  headers: { 'Content-Type': 'application/json' },
  body: `${JSON.stringify({ Name: cid, Hash: cid, Size: '5' })}\n`
});

const cidOf = (text) => cidv1Raw(new TextEncoder().encode(text));

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

beforeEach(() => {
  requests.length = 0;
  answer = () => ({ status: 200, body: '' });
});

test('initialize sends the token as given in the URL form', async () => {
  initialize(base, undefined, undefined, 'Bearer writer-token');
  answer = () => addAnswer(cidOf('hello'));
  assert.equal(await uploadToIPFS('hello'), cidOf('hello'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, 'Bearer writer-token');
  assert.match(requests[0].url, /^\/api\/v0\/add\?/);
});

test('initialize sends no Authorization header without a token', async () => {
  initialize(base);
  answer = () => addAnswer(cidOf('hello'));
  await uploadToIPFS('hello');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, undefined);
});

test('initialize sends the token as given in the host form', async () => {
  initialize('127.0.0.1', 'http', server.address().port, 'raw-token');
  answer = () => addAnswer(cidOf('hello'));
  await uploadToIPFS('hello');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, 'raw-token');
});

test('a 403 on add is not retried and names the writer token and the alternatives', async () => {
  initialize(base);
  answer = () => ({ status: 403, body: 'writer token required' });
  await assert.rejects(uploadToIPFS('hello', 3, 10), (e) => {
    assert.match(e.message, /refused the add \(403\)/);
    assert.match(e.message, /writer token/);
    assert.match(e.message, /initializePublicIntake\(\)/);
    assert.match(e.message, /initializeStorage\('http:\/\/127\.0\.0\.1:5001'\)/);
    return true;
  });
  assert.equal(requests.length, 1);
});

test('a 401 on add is not retried either', async () => {
  initialize(base);
  answer = () => ({ status: 401, body: 'unauthorized' });
  await assert.rejects(uploadToIPFS('hello', 3, 10), /refused the add \(401\)/);
  assert.equal(requests.length, 1);
});

test('a 5xx on add is retried up to the attempts given', async () => {
  initialize(base);
  answer = () => ({ status: 500, body: 'boom' });
  await assert.rejects(uploadToIPFS('hello', 2, 10), /upload failed after 2 attempts/);
  assert.equal(requests.length, 2);
});

test('flushPending delivers only the CIDs it is given, under the request they belong to', async () => {
  initializeIntake('bloxberg_testnet', base);
  const cidA = await uploadToIPFS('alpha');
  const cidB = await uploadToIPFS('beta');
  assert.equal(cidA, cidOf('alpha'));
  assert.equal(requests.length, 0);

  await flushPending(7, [cidA]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, `/payload/bloxberg_testnet/7/${cidA}`);
  assert.equal(requests[0].body.toString(), 'alpha');

  await flushPending(8, [cidB]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, `/payload/bloxberg_testnet/8/${cidB}`);
  assert.equal(requests[1].body.toString(), 'beta');
});

test('flushPending refuses a CID that was not uploaded through the intake', async () => {
  initializeIntake('bloxberg_testnet', base);
  const cid = await uploadToIPFS('gamma');
  await flushPending(9, [cid]);
  assert.equal(requests.length, 1);
  await assert.rejects(flushPending(10, [cid]), /was not uploaded through the intake/);
  await assert.rejects(flushPending(10, [cidOf('never')]), /was not uploaded through the intake/);
  assert.equal(requests.length, 1);
});

test('the intake takes an artefact of one block and refuses a larger one before any request', async () => {
  initializeIntake('bloxberg_testnet', base);
  const block = 'x'.repeat(RAW_BLOCK_MAX);
  assert.equal(await uploadToIPFS(block), cidOf(block));
  await assert.rejects(uploadToIPFS(`${block}x`), /above the 1048576-byte limit of the payload intake/);
  assert.equal(requests.length, 0);
});

test('an add to an IPFS API uses chunks of Kubo\'s largest block', async () => {
  initialize(`${base}/api/v0`);
  answer = () => addAnswer(cidOf('epsilon'));
  await uploadToIPFS('epsilon');
  assert.match(requests[0].url, /chunker=size-1048576/);
});

test('flushPending throws at once when the intake refuses a blob', async () => {
  initializeIntake('bloxberg_testnet', base);
  const cid = await uploadToIPFS('delta');
  answer = () => ({ status: 404, body: 'no such request' });
  await assert.rejects(flushPending(11, [cid], 3, 10), /intake refused .* 404/);
  assert.equal(requests.length, 1);
});
