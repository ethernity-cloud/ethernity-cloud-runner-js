import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { initialize, initializeIntake, uploadToIPFS, flushPending, cidv1Raw, unixfsCid, BLOCK_SIZE, INTAKE_NOT_NAMED_ATTEMPTS } from '../ipfs.js';

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

// The first n bytes of the byte values 0..250 repeated: the files Kubo 0.36.0
// and 0.42.0 named the CIDs below, through `add --cid-version=1 --raw-leaves`,
// with the default chunker and with the chunker passed.
const pattern = (n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = i % 251;
  return out;
};

test('content up to one block is named by its raw CID', () => {
  assert.equal(BLOCK_SIZE, 262144);
  const content = pattern(BLOCK_SIZE);
  assert.equal(unixfsCid(content), cidv1Raw(content));
  assert.equal(unixfsCid(content), 'bafkreibruh455iawsviqslif5c7uurdcfdemh22mtnytyzvnzn75kpejxy');
});

test('content above one block is named by its UnixFS root', () => {
  assert.equal(unixfsCid(pattern(BLOCK_SIZE + 1)), 'bafybeiexg2oqkfnj56l7fcmawswqbijt5shq4b5rg6a546uwpkqqzwjioi');
  assert.equal(unixfsCid(pattern(648000)), 'bafybeicnawjqvxvtindqftaj5acjkqb6lh5sove2uqkdrzjkwooypl56zu');
  assert.equal(unixfsCid(pattern(1048576)), 'bafybeiedpcapwld4tkgtzwahfofgn4wex5ryysf4se6hwpmlrsh4ntnrau');
  assert.equal(unixfsCid(pattern(2621440)), 'bafybeichq3thyi62tokqze6l4467yvja3nw7w34y7w52vn6h7lyo7qgxoy');
});

test('more blocks than a node links make a second level', () => {
  // 184330 bytes in 1 KiB blocks are 181 leaves: 174 under one node and 7
  // under another, both under the root (Kubo, chunker=size-1024).
  assert.equal(unixfsCid(pattern(184330), 1024), 'bafybeids2yxkrcqqq6cpa7lgs6hv5xpsfn2bctwvljcrq73hhhzhszxkvy');
});

test('the intake queues an artefact of any size under its CID', async () => {
  initializeIntake('bloxberg_testnet', base);
  assert.equal(await uploadToIPFS(pattern(648000)), 'bafybeicnawjqvxvtindqftaj5acjkqb6lh5sove2uqkdrzjkwooypl56zu');
  assert.equal(requests.length, 0);
});

test("an add to an IPFS API passes Kubo's default chunk size", async () => {
  initialize(`${base}/api/v0`);
  answer = () => addAnswer(cidOf('epsilon'));
  await uploadToIPFS('epsilon');
  assert.match(requests[0].url, /chunker=size-262144/);
});

test('flushPending throws at once when the intake refuses a blob', async () => {
  initializeIntake('bloxberg_testnet', base);
  const cid = await uploadToIPFS('delta');
  answer = () => ({ status: 404, body: 'no such request' });
  await assert.rejects(flushPending(11, [cid], 3, 10), /intake refused .* 404/);
  assert.equal(requests.length, 1);
});

// The intake answers 403 "does not name this cid" while its RPC replica has
// not yet seen the row the client just had the receipt of (bloxberg testnet,
// 2026-10-25: a session's seventh input was refused this way and the session
// died).
test('flushPending waits through the 403 the intake answers before its replica sees the row', async () => {
  initializeIntake('bloxberg_testnet', base);
  const cid = await uploadToIPFS('zeta');
  let answers = 0;
  answer = () => {
    answers += 1;
    return answers <= 2 ? { status: 403, body: '{"error": "the DO request does not name this cid"}' } : { status: 200, body: '{}' };
  };
  await flushPending(12, [cid], 3, 10);
  assert.equal(requests.length, 3);
});

test('a 403 that persists past the attempts allowed for it is reported with the attempts made', async () => {
  initializeIntake('bloxberg_testnet', base);
  const cid = await uploadToIPFS('eta');
  answer = () => ({ status: 403, body: '{"error": "the DO request does not name this cid"}' });
  await assert.rejects(flushPending(13, [cid], 3, 1), new RegExp(`did not accept .* after ${INTAKE_NOT_NAMED_ATTEMPTS} attempts: 403`));
  assert.equal(requests.length, INTAKE_NOT_NAMED_ATTEMPTS);
});
