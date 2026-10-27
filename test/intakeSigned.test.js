// deliverSigned: a queued blob is lodged with the intake under the request
// owner's signature before the request names it; one the intake takes leaves
// the queue, one it refuses stays for flushPending after the row (bloxberg
// testnet rig, 2026-10-26: two clients stopped between committing an input's
// row and uploading its bytes, and the row without bytes held their sessions
// until the deadline). A loopback server stands in for the intake.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  initialize, initializeIntake, uploadToIPFS, flushPending, deliverSigned, intakeNetwork,
  ownerSignatureMessage, OWNER_SIGNATURE_HEADER, INTAKE_UNSIGNED_PATH
} from '../ipfs.js';

const requests = [];
let answer = () => ({ status: 200, body: '{}' });
let base = '';
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
  const reply = answer();
  res.writeHead(reply.status, { 'Content-Type': 'application/json' });
  res.end(reply.body);
});

before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => { server.close(resolve); });
});

beforeEach(() => {
  requests.length = 0;
  answer = () => ({ status: 200, body: '{}' });
});

test('the message names the network and the request', () => {
  assert.equal(ownerSignatureMessage('bloxberg_testnet', 4935), 'etny-intake|bloxberg_testnet|4935');
  assert.equal(OWNER_SIGNATURE_HEADER, 'X-Etny-Owner-Signature');
  assert.equal(INTAKE_UNSIGNED_PATH, 'does not name this cid');
});

test('a lodged blob goes out with the signature and leaves the queue', async () => {
  initializeIntake('bloxberg_testnet', base);
  assert.equal(intakeNetwork(), 'bloxberg_testnet');
  const cid = await uploadToIPFS('alpha');
  const result = await deliverSigned(7, [cid], '0xsignature');
  assert.deepEqual(result, { delivered: [cid], refused: {} });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `/payload/bloxberg_testnet/7/${cid}`);
  assert.equal(requests[0].headers['x-etny-owner-signature'], '0xsignature');
  assert.equal(requests[0].body.toString(), 'alpha');
  await assert.rejects(flushPending(7, [cid]), /was not uploaded through the intake/);
});

test('a blob an intake without the signed path refuses stays queued and goes after the row', async () => {
  initializeIntake('bloxberg_testnet', base);
  const cid = await uploadToIPFS('beta');
  answer = () => ({ status: 403, body: '{"error": "the DO request does not name this cid"}' });
  const result = await deliverSigned(8, [cid], '0xsignature', 3, 10);
  assert.deepEqual(result.delivered, []);
  assert.match(result.refused[cid], /^403 .*does not name this cid/);
  assert.equal(requests.length, 1);
  answer = () => ({ status: 200, body: '{}' });
  await flushPending(8, [cid]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers['x-etny-owner-signature'], undefined);
});

test('a 5xx is tried again and a later 200 delivers', async () => {
  initializeIntake('bloxberg_testnet', base);
  const cid = await uploadToIPFS('gamma');
  let answers = 0;
  answer = () => {
    answers += 1;
    return answers === 1 ? { status: 503, body: '{"error": "IPFS unavailable"}' } : { status: 200, body: '{}' };
  };
  const result = await deliverSigned(9, [cid], '0xsignature', 3, 10);
  assert.deepEqual(result, { delivered: [cid], refused: {} });
  assert.equal(requests.length, 2);
});

test('a blob never queued and a missing intake are no-ops', async () => {
  initializeIntake('bloxberg_testnet', base);
  assert.deepEqual(await deliverSigned(10, ['bafkreinotqueued'], '0xsignature'), { delivered: [], refused: {} });
  initialize('http://127.0.0.1:1', 'http', 1);
  assert.equal(intakeNetwork(), null);
  assert.deepEqual(await deliverSigned(10, ['bafkreinotqueued'], '0xsignature'), { delivered: [], refused: {} });
  assert.equal(requests.length, 0);
});
