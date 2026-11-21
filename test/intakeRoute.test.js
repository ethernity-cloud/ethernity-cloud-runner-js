// The intake route of a run. The bootnode's payload intake takes an artefact
// at POST {intake}/payload/<network>/<doRequestId>/<cid>, under the route of
// the network whose DO request names it. The intake is the storage of the
// process, set by the first run that finds none or by the application; the
// route of each artefact is its own run's network (the descriptor's
// agentNetwork), fixed when the artefact is sealed and queued, whichever
// network the intake was set for: runs of several runners on several routed
// networks, one after the other or at once, each deliver under their own
// route, and so does a session's input. An IPFS API the application set is
// used as set, and nothing goes to an intake.
//
// The chain is a stand-in at the provider (fixtures/standInChain.js), whose
// registries answer one certificate made here, so the artefacts are sealed
// and queued by the runner's own code. fetch is stood in for the intakes: it
// records each POST and answers 200. The result's download and decryption
// are stood in for on the runner. The tests share the process's storage and
// run in the order they are written in.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jsrsasign from 'jsrsasign';
import EthernityCloudRunner from '../runner.js';
import { ECAddress } from '../enums.js';
import { cidv1Raw, intakeNetwork, isInitialized, OWNER_SIGNATURE_HEADER, PUBLIC_INTAKE } from '../ipfs.js';
import { configureHeldCache } from '../heldCache.js';
import { AMOY, AMOY_TOKEN, BLOXBERG, BLOXBERG_TOKEN, chainOf, settle } from './fixtures/standInChain.js';

const SECURELOCK = 'my-securelock';
const RESOURCES = { taskPrice: 3, validators: 1, duration: 1 };
// An intake of the application's own choice (initializePublicIntake(baseUrl)).
const CHOSEN_INTAKE = 'https://intake.example';
const BLOXBERG_POX = ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS;
const AMOY_POX = ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS;

// An EC P-384 certificate, the kind a trustedzone registers, for sealing.
const certificate = () => {
  const kp = jsrsasign.KEYUTIL.generateKeypair('EC', 'secp384r1');
  return new jsrsasign.KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { int: 1 },
    issuer: { str: '/CN=trustedzone' },
    subject: { str: '/CN=trustedzone' },
    notbefore: '250101000000Z',
    notafter: '350101000000Z',
    sbjpubkey: kp.pubKeyObj,
    sigalg: 'SHA256withECDSA',
    cakey: kp.prvKeyObj
  }).getPEM();
};
const PEM = certificate();

// The POSTs the intakes received, as URLs in the order they were answered,
// and the owner's signature each carried. `beforeAnswer`, when set, is
// awaited with the URL before a POST is answered.
const posts = [];
const signatures = {};
let beforeAnswer = null;
const networkFetch = globalThis.fetch;

// A loopback Kubo RPC API: it answers every add with the CID of the bytes
// added and lists the CIDs in `added`.
const added = [];
const api = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const parts = Buffer.concat(chunks).toString('latin1').split('\r\n');
  const content = parts[parts.length - 3] ?? '';
  const cid = cidv1Raw(Buffer.from(content, 'latin1'));
  added.push(cid);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(`${JSON.stringify({ Name: cid, Hash: cid, Size: String(content.length) })}\n`);
});
let apiBase = '';
let heldDirectory = '';

before(async () => {
  heldDirectory = await mkdtemp(join(tmpdir(), 'etny-held-'));
  configureHeldCache({ directory: heldDirectory });
  await new Promise((resolve) => { api.listen(0, '127.0.0.1', resolve); });
  apiBase = `http://127.0.0.1:${api.address().port}`;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (![PUBLIC_INTAKE, CHOSEN_INTAKE].some((intake) => target.startsWith(`${intake}/`))) return networkFetch(url, init);
    if (beforeAnswer) await beforeAnswer(target);
    posts.push(target);
    signatures[target] = init.headers[OWNER_SIGNATURE_HEADER];
    return { status: 200, text: async () => '{}' };
  };
});

after(async () => {
  globalThis.fetch = networkFetch;
  api.closeAllConnections();
  await new Promise((resolve) => { api.close(resolve); });
  await rm(heldDirectory, { recursive: true, force: true });
});

beforeEach(() => {
  posts.length = 0;
  added.length = 0;
  beforeAnswer = null;
});

// A runner constructed with `token` on a chain of `network` of its own, whose
// registries answer PEM for every trustedzone.
const runnerOn = (network, token) => {
  const chain = chainOf(network, { certificate: () => PEM });
  const runner = new EthernityCloudRunner(token, {
    provider: chain.provider,
    signer: chain.signer,
    encryptionPublicKey: 'ab'.repeat(32)
  });
  runner.dispatchECEvent = () => {};
  runner.getOrderResult = async () => {
    runner.result = await runner.protocolContract.getResultFromOrder(runner.orderId);
    await settle();
  };
  return { chain, runner };
};

const task = (runner) => runner.run(RESOURCES, SECURELOCK, 'code', '', null, { maxRetries: 0 });

// The CIDs request `n` of the PoX at `pox` on `chain` names: its challenge
// (field 4 of its image metadata) and its code (field 1 of its code
// metadata).
const namedBy = (chain, pox, n) => {
  const [image, code] = chain.at(pox).requests[n].metadata;
  return [image.split(':')[4], code.split(':')[1]];
};

// The POSTs request `n` of the PoX at `pox` on `chain` is due at `intake`
// under `route`: one per CID it names.
const due = (chain, pox, n, route, intake = PUBLIC_INTAKE) =>
  namedBy(chain, pox, n).map((cid) => `${intake}/payload/${route}/${n}/${cid}`);

test('runs on two routed networks, one after the other: the first takes the public intake, and each delivers under its own route', { timeout: 60000 }, async () => {
  assert.equal(isInitialized(), false);
  const bloxberg = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  const amoy = runnerOn(AMOY, AMOY_TOKEN);
  await task(bloxberg.runner);
  // The intake is the one the Bloxberg testnet's run set, from here on.
  assert.equal(intakeNetwork(), 'bloxberg_testnet');
  await task(amoy.runner);
  await task(bloxberg.runner);
  // The -unsafe network of Polygon Amoy has the route of the network it is named after.
  await amoy.runner.setNetwork('POLYGON', 'TESTNET_UNSAFE');
  await task(amoy.runner);
  assert.deepEqual(posts, [
    ...due(bloxberg.chain, BLOXBERG_POX, 0, 'bloxberg_testnet'),
    ...due(amoy.chain, AMOY_POX, 0, 'polygon_amoy'),
    ...due(bloxberg.chain, BLOXBERG_POX, 1, 'bloxberg_testnet'),
    ...due(amoy.chain, AMOY_POX, 1, 'polygon_amoy')
  ]);
  assert.equal(intakeNetwork(), 'bloxberg_testnet');
});

test('runs of two runners on two routed networks at once: a whole run of the other network between the seal and the delivery of a run leaves each under its own route', { timeout: 60000 }, async () => {
  const bloxberg = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  const amoy = runnerOn(AMOY, AMOY_TOKEN);
  // The Bloxberg run's artefacts are sealed and its request is on chain when
  // its first POST is made: the Amoy run is made, whole, before that POST is
  // answered.
  let between = null;
  beforeAnswer = async (url) => {
    if (between === null && url.includes('/payload/bloxberg_testnet/')) {
      between = task(amoy.runner);
      await between;
    }
  };
  await task(bloxberg.runner);
  assert.deepEqual(posts, [
    ...due(amoy.chain, AMOY_POX, 0, 'polygon_amoy'),
    ...due(bloxberg.chain, BLOXBERG_POX, 0, 'bloxberg_testnet')
  ]);

  // The reverse: a whole Bloxberg run inside an Amoy run.
  posts.length = 0;
  between = null;
  beforeAnswer = async (url) => {
    if (between === null && url.includes('/payload/polygon_amoy/')) {
      between = task(bloxberg.runner);
      await between;
    }
  };
  await task(amoy.runner);
  assert.deepEqual(posts, [
    ...due(bloxberg.chain, BLOXBERG_POX, 1, 'bloxberg_testnet'),
    ...due(amoy.chain, AMOY_POX, 1, 'polygon_amoy')
  ]);

  // Four runs called together, two per runner.
  posts.length = 0;
  beforeAnswer = null;
  await Promise.all([task(bloxberg.runner), task(amoy.runner), task(bloxberg.runner), task(amoy.runner)]);
  assert.deepEqual([...posts].sort(), [
    ...due(bloxberg.chain, BLOXBERG_POX, 2, 'bloxberg_testnet'),
    ...due(bloxberg.chain, BLOXBERG_POX, 3, 'bloxberg_testnet'),
    ...due(amoy.chain, AMOY_POX, 2, 'polygon_amoy'),
    ...due(amoy.chain, AMOY_POX, 3, 'polygon_amoy')
  ].sort());
});

test('a session\'s inputs go under the route of the session\'s network: after its row, and before it under the owner\'s signature of that route', { timeout: 60000 }, async () => {
  assert.equal(intakeNetwork(), 'bloxberg_testnet');
  // The wallet context the runner builds carries no signMessage: the input
  // goes out after its row.
  const unsigned = runnerOn(AMOY, AMOY_TOKEN);
  const session = await unsigned.runner.runSession(RESOURCES, SECURELOCK, 'code');
  posts.length = 0;
  assert.equal(await session.sendInput('an input'), 0);
  const inputOf = (chain, doReq) => chain.at(AMOY_POX).requests[doReq].rows[0][1].split(':')[3];
  assert.deepEqual(posts, [`${PUBLIC_INTAKE}/payload/polygon_amoy/${session.doReq}/${inputOf(unsigned.chain, session.doReq)}`]);
  assert.equal(signatures[posts[0]], undefined);

  // With a wallet context that signs, the input is lodged before its row.
  const signing = runnerOn(AMOY, AMOY_TOKEN);
  const signed = [];
  signing.runner.walletContext.signMessage = async (message) => {
    signed.push(message);
    return '0xsignature';
  };
  const lodging = await signing.runner.runSession(RESOURCES, SECURELOCK, 'code');
  posts.length = 0;
  beforeAnswer = async () => {
    assert.deepEqual(signing.chain.at(AMOY_POX).requests[lodging.doReq].rows, []);
  };
  assert.equal(await lodging.sendInput('an input'), 0);
  assert.deepEqual(signed, [`etny-intake|polygon_amoy|${lodging.doReq}`]);
  assert.deepEqual(posts, [`${PUBLIC_INTAKE}/payload/polygon_amoy/${lodging.doReq}/${inputOf(signing.chain, lodging.doReq)}`]);
  assert.equal(signatures[posts[0]], '0xsignature');
});

test('an intake the application chose on one network is the intake of every run, each under its own route', { timeout: 60000 }, async () => {
  const bloxberg = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  const amoy = runnerOn(AMOY, AMOY_TOKEN);
  amoy.runner.initializePublicIntake(CHOSEN_INTAKE);
  assert.equal(intakeNetwork(), 'polygon_amoy');
  await task(bloxberg.runner);
  await task(amoy.runner);
  assert.deepEqual(posts, [
    ...due(bloxberg.chain, BLOXBERG_POX, 0, 'bloxberg_testnet', CHOSEN_INTAKE),
    ...due(amoy.chain, AMOY_POX, 0, 'polygon_amoy', CHOSEN_INTAKE)
  ]);
  assert.equal(intakeNetwork(), 'polygon_amoy');
});

test('an IPFS API the application set is used as set: the runs on routed networks add their artefacts to it, and nothing goes to an intake', { timeout: 60000 }, async () => {
  const bloxberg = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  const amoy = runnerOn(AMOY, AMOY_TOKEN);
  await bloxberg.runner.initializeStorage(apiBase);
  assert.equal(intakeNetwork(), null);
  await task(bloxberg.runner);
  await task(amoy.runner);
  assert.deepEqual(posts, []);
  assert.deepEqual(added, [...namedBy(bloxberg.chain, BLOXBERG_POX, 0), ...namedBy(amoy.chain, AMOY_POX, 0)]);
  assert.equal(intakeNetwork(), null);
});
