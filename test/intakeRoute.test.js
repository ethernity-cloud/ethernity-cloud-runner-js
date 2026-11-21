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
// The chain is a stand-in at the provider (testing/standInChain.js), whose
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
import {
  cidv1Raw, flushPending, initializeIntake, intakeNetwork, isInitialized, OWNER_SIGNATURE_HEADER, PUBLIC_INTAKE, StorageLimitError
} from '../ipfs.js';
import { configureHeldCache } from '../heldCache.js';
import { SessionError } from '../session.js';
import { AMOY, AMOY_TOKEN, BLOXBERG, BLOXBERG_TOKEN, chainOf, settle } from '../testing/standInChain.js';

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
// awaited with the URL before a POST is answered. `refusal`, when set, is
// the { status, text } the intakes answer in place of a 200.
const posts = [];
const signatures = {};
let beforeAnswer = null;
let refusal = null;
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
    if (refusal) return { status: refusal.status, text: async () => refusal.text };
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
  refusal = null;
});

// A runner constructed with `token` on a chain of `network` of its own, whose
// registries answer PEM for every trustedzone. Its wallet gives the
// encryption key `encryptionPublicKey`; with null it gives none.
const runnerOn = (network, token, encryptionPublicKey = 'ab'.repeat(32)) => {
  const chain = chainOf(network, { certificate: () => PEM });
  const runner = new EthernityCloudRunner(token, {
    provider: chain.provider,
    signer: chain.signer,
    encryptionPublicKey
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

test('a storage call of another runner between the seal and the delivery of a run drops none of its artefacts: they go to the intake they were queued for', { timeout: 60000 }, async () => {
  // What another runner calls while the Bloxberg run's artefacts are queued
  // and its request is being sent, and the storage in effect afterwards.
  const calls = [
    [(other) => other.initializePublicIntake(), 'polygon_amoy'],
    [(other) => other.initializePublicIntake(CHOSEN_INTAKE), 'polygon_amoy'],
    [(other) => { other.initializeStorage(apiBase); }, null]
  ];
  for (const [call, storage] of calls) {
    const bloxberg = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
    const amoy = runnerOn(AMOY, AMOY_TOKEN);
    bloxberg.runner.initializePublicIntake();
    posts.length = 0;
    bloxberg.chain.during('send', '_addDORequest', () => call(amoy.runner));
    await task(bloxberg.runner);
    assert.deepEqual(posts, due(bloxberg.chain, BLOXBERG_POX, 0, 'bloxberg_testnet'));
    assert.equal(intakeNetwork(), storage);
  }

  // The other direction: the run's artefacts are added to an IPFS API, and
  // another runner sets the intake while the request is being sent. The run
  // has nothing queued, and nothing to deliver to the intake.
  const bloxberg = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  const amoy = runnerOn(AMOY, AMOY_TOKEN);
  await bloxberg.runner.initializeStorage(apiBase);
  posts.length = 0;
  added.length = 0;
  bloxberg.chain.during('send', '_addDORequest', () => amoy.runner.initializePublicIntake());
  await task(bloxberg.runner);
  assert.deepEqual(added, namedBy(bloxberg.chain, BLOXBERG_POX, 0));
  assert.deepEqual(posts, []);
  assert.equal(intakeNetwork(), 'polygon_amoy');
});

test('a session input added to an IPFS API, with the intake set by another runner before it is lodged, is committed once and goes to no intake; a queued input the intake refuses is not committed', { timeout: 60000 }, async () => {
  // A session on the Bloxberg testnet whose wallet signs, with an IPFS API
  // of the application's own as the storage. Another runner sets the intake
  // between the first input's seal and its lodging.
  const bloxberg = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  const amoy = runnerOn(AMOY, AMOY_TOKEN);
  bloxberg.runner.walletContext.signMessage = async () => '0xsignature';
  await bloxberg.runner.initializeStorage(apiBase);
  const session = await bloxberg.runner.runSession(RESOURCES, SECURELOCK, 'code');
  const seal = bloxberg.runner._sealArtefact.bind(bloxberg.runner);
  bloxberg.runner._sealArtefact = async (...given) => {
    const artefact = await seal(...given);
    if (intakeNetwork() === null) amoy.runner.initializePublicIntake();
    return artefact;
  };
  posts.length = 0;
  added.length = 0;
  const rows = () => bloxberg.chain.at(BLOXBERG_POX).requests[session.doReq].rows;
  const inputOf = (row) => row[1].split(':')[3];
  assert.equal(await session.sendInput('an input'), 0);
  assert.equal(intakeNetwork(), 'polygon_amoy');
  assert.equal(rows().length, 1);
  assert.deepEqual(added, [inputOf(rows()[0])]);
  assert.deepEqual(posts, []);

  // The next input is queued for the intake, the storage now, and lodged
  // under the owner's signature before its row.
  assert.equal(await session.sendInput('another input'), 1);
  assert.equal(rows().length, 2);
  assert.deepEqual(posts, [`${PUBLIC_INTAKE}/payload/bloxberg_testnet/${session.doReq}/${inputOf(rows()[1])}`]);
  assert.equal(signatures[posts[0]], '0xsignature');

  // A queued input whose lodging the intake refuses is not committed.
  posts.length = 0;
  refusal = { status: 400, text: 'refused' };
  await assert.rejects(session.sendInput('a third input'), (error) => error instanceof SessionError &&
    error.message === 'input 2 was not lodged with the intake (400 refused); not committed, send it again');
  assert.equal(posts.length, 1);
  assert.equal(rows().length, 2);
});

// The artefacts `runner` holds the CIDs of: its challenge, its code and its
// input dataset.
const artefactsOf = (runner) => [runner.challengeIPFSHash, runner.scriptHash, runner.fileSetHash].filter(Boolean);

test('a request that is not made, and a session input whose row is not committed, leave none of their artefacts queued', { timeout: 60000 }, async () => {
  const { chain, runner } = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  runner.initializePublicIntake();
  chain.during('send', '_addDORequest', () => { throw new Error('the wallet refused the transaction'); });
  await assert.rejects(task(runner), { message: 'Transaction failed: the wallet refused the transaction' });
  assert.deepEqual(posts, []);
  // A flush delivers what is queued: for these CIDs it sends nothing.
  assert.equal(artefactsOf(runner).length, 2);
  for (const cid of artefactsOf(runner)) assert.match(cid, /^b[a-z2-7]+$/);
  await flushPending(0, artefactsOf(runner));
  assert.deepEqual(posts, []);

  // A session's input: the CID its seal gives is kept here, the transaction
  // of its row fails.
  const session = await runner.runSession(RESOURCES, SECURELOCK, 'code');
  const seal = runner._sealArtefact.bind(runner);
  const sealed = [];
  runner._sealArtefact = async (...given) => {
    const artefact = await seal(...given);
    sealed.push(artefact.cid);
    return artefact;
  };
  posts.length = 0;
  chain.during('send', '_addMetadataToRequest', () => { throw new Error('the wallet refused the transaction'); });
  await assert.rejects(session.sendInput('an input'), { message: 'the wallet refused the transaction' });
  assert.equal(sealed.length, 1);
  await flushPending(session.doReq, sealed);
  assert.deepEqual(posts, []);
  // The input sent again is sealed again and delivered.
  assert.equal(await session.sendInput('an input'), 0);
  assert.equal(sealed.length, 2);
  assert.deepEqual(posts, [`${PUBLIC_INTAKE}/payload/bloxberg_testnet/${session.doReq}/${sealed[1]}`]);
});

test('a failure before the request (a wallet that gives no encryption key, an artefact the intake does not take) leaves none of the artefacts sealed so far queued', { timeout: 60000 }, async () => {
  const noKey = 'Cannot obtain the wallet encryption public key: this wallet has no eth_getEncryptionPublicKey. ' +
    'Pass { privateKey } (to derive it) or { encryptionPublicKey } to EthernityCloudRunner.';
  // What the intake set below takes per blob, and a text it does not take.
  // The blobs it refuses are held in a cache of this test's own.
  const limit = 4096;
  const large = 'x'.repeat(4 * limit);
  const refusedDirectory = await mkdtemp(join(tmpdir(), 'etny-held-'));
  configureHeldCache({ directory: refusedDirectory });
  const starts = {
    'run()': (runner, code, options = {}) => runner.run(RESOURCES, SECURELOCK, code, '', null, { maxRetries: 0, ...options }),
    'runSession()': (runner, code) => runner.runSession(RESOURCES, SECURELOCK, code)
  };
  // After each failure a flush of the runner's CIDs, which delivers what is
  // queued, sends nothing.
  const nothingQueued = async (runner, label) => {
    await flushPending(0, artefactsOf(runner));
    assert.deepEqual(posts, [], label);
  };
  for (const [label, start] of Object.entries(starts)) {
    // The challenge is sealed and queued, then the wallet gives no key.
    const keyless = runnerOn(BLOXBERG, BLOXBERG_TOKEN, null);
    keyless.runner.initializePublicIntake();
    posts.length = 0;
    await assert.rejects(start(keyless.runner, 'code'), { message: noKey }, label);
    assert.match(keyless.runner.challengeIPFSHash, /^b[a-z2-7]+$/, label);
    assert.deepEqual(keyless.chain.at(BLOXBERG_POX).requests, [], label);
    await nothingQueued(keyless.runner, `${label}, no encryption key`);

    // The challenge is sealed and queued, then the code is above the limit.
    const { chain, runner } = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
    initializeIntake('bloxberg_testnet', PUBLIC_INTAKE, limit);
    await assert.rejects(start(runner, large), (error) => error instanceof StorageLimitError && error.limit === limit, label);
    assert.match(runner.challengeIPFSHash, /^b[a-z2-7]+$/, label);
    assert.deepEqual(chain.at(BLOXBERG_POX).requests, [], label);
    await nothingQueued(runner, `${label}, the code refused`);
  }
  // A run's input dataset above the limit: the challenge and the code are
  // sealed and queued before it.
  const { chain, runner } = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  await assert.rejects(starts['run()'](runner, 'code', { inputData: large }), (error) => error instanceof StorageLimitError);
  assert.match(runner.scriptHash, /^b[a-z2-7]+$/);
  assert.deepEqual(chain.at(BLOXBERG_POX).requests, []);
  await nothingQueued(runner, 'run(), the input refused');
  configureHeldCache({ directory: heldDirectory });
  await rm(refusedDirectory, { recursive: true, force: true });
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
