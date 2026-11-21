// EthernityCloudSession: output rows are verified against the task wallet the
// trustedzone attests in the session's 'etny-sw' row, which the runner checks
// with the trustedzone's certificate. An output row before any attestation, an
// attestation that does not verify, and an output not signed by the attested
// wallet are refused. The certificate is the one the runner read for the
// session's trustedzone on the session's network, whatever it read before or
// since. No chain: the contract is a stand-in; the certificate and the
// wallets are made here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsrsasign from 'jsrsasign';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { EthernityCloudSession } from '../session.js';
import { verifyCertificateSignature } from '../crypto.js';

const ORDER = 2022;
// The network descriptor and the trustedzone of the sessions made here, and
// another of each.
const NETWORK = { networkKey: 'POLYGON' };
const OTHER_NETWORK = { networkKey: 'POLYGON' };
const ZONE = 'ecld-pynithy-amoy';
const OTHER_ZONE = 'ecld-pynithy-amoy-unsafe';

// A P-384 key pair and its self-signed certificate PEM, as the Image Registry
// holds a trustedzone's.
const certificate = () => {
  const kp = jsrsasign.KEYUTIL.generateKeypair('EC', 'secp384r1');
  const pem = new jsrsasign.KJUR.asn1.x509.Certificate({
    version: 3, serial: { int: 1 }, issuer: { str: '/CN=trustedzone' }, subject: { str: '/CN=trustedzone' },
    notbefore: '250101000000Z', notafter: '350101000000Z', sbjpubkey: kp.pubKeyObj, sigalg: 'SHA256withECDSA', cakey: kp.prvKeyObj
  }).getPEM();
  return { kp, pem };
};

const signDer = (kp, message) => {
  const signature = new jsrsasign.KJUR.crypto.Signature({ alg: 'SHA256withECDSA' });
  signature.init(kp.prvKeyObj);
  signature.updateString(message);
  return signature.sign();
};

const attestation = (kp, wallet, order = ORDER) => `v1:${order}:${wallet}:${signDer(kp, `etny-sw|${order}|${wallet}`)}`;

// A signed 'late' notice: an output row with no payload to fetch.
const noticeRow = async (signer, seq, order = ORDER) => {
  const sig = await signer.signMessage(`etny-so|${order}|${seq}|${seq}|late|0||`);
  return `v1:${seq}:${order}:${seq}:late:0:::${sig}`;
};

// A runner as a handle reads it, on NETWORK, whose PoX answers the metadata
// `rows` of the session's DP request: its PoX contract, its network
// descriptor, the trustedzone of its last registry read and the certificates
// it has read, kept and answered as the runner keeps and answers them
// (trustedZoneCertificates, trustedZoneCertificate).
const runnerOver = (rows) => ({
  protocolContract: {
    getContract: () => ({
      _getMetadataCountForDPRequest: async () => rows.length,
      _getMetadataValueForDPRequest: async (dpReq, i) => rows[i]
    })
  },
  networkConfig: NETWORK,
  enclaveDetailsTrustedZone: null,
  trustedZoneCertificates: new Map(),
  trustedZoneCertificate: EthernityCloudRunner.prototype.trustedZoneCertificate,
  dispatchECEvent: () => {}
});

// The registry of `network` answers `runner` the certificate `pem` for
// `trustedZone`: what getEnclaveDetails records of a read.
const reads = (runner, network, trustedZone, pem) => {
  if (!runner.trustedZoneCertificates.has(network)) runner.trustedZoneCertificates.set(network, new Map());
  runner.trustedZoneCertificates.get(network).set(trustedZone, pem);
  Object.assign(runner, { enclavePublicKey: pem, enclaveDetailsNetwork: network, enclaveDetailsTrustedZone: trustedZone });
};

// A handle of ZONE over `rows`, made on a runner that has read `pem` for it
// on NETWORK.
const sessionWith = (rows, pem) => {
  const runner = runnerOver(rows);
  reads(runner, NETWORK, ZONE, pem);
  const session = new EthernityCloudSession(runner, ORDER, ZONE);
  session.dpReq = 9;
  session.doReq = 7;
  return session;
};

test('the certificate key signature verifies and a tampered one does not', () => {
  const { kp, pem } = certificate();
  const sig = signDer(kp, 'etny-sw|2022|0xabc');
  assert.equal(verifyCertificateSignature(pem, 'etny-sw|2022|0xabc', sig), true);
  assert.equal(verifyCertificateSignature(pem, 'etny-sw|2022|0xabd', sig), false);
  assert.equal(verifyCertificateSignature(pem, 'etny-sw|2022|0xabc', '3003020100'), false);
});

test('outputs signed by the attested wallet are delivered', async () => {
  const { kp, pem } = certificate();
  const task = ethers.Wallet.createRandom();
  const session = sessionWith([['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(task, 0)],
    ['etny-so', await noticeRow(task, 1)]], pem);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [0, 1]);
  assert.equal(session._taskWallet(), task.address);
});

test('an output before any attestation is discarded', async () => {
  const { kp, pem } = certificate();
  const task = ethers.Wallet.createRandom();
  const session = sessionWith([['etny-so', await noticeRow(task, 0)], ['etny-sw', attestation(kp, task.address)],
    ['etny-so', await noticeRow(task, 1)]], pem);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [1]);
});

test('an attestation not made with the certificate key is ignored', async () => {
  const { pem } = certificate();
  const other = certificate();
  const task = ethers.Wallet.createRandom();
  const session = sessionWith([['etny-sw', attestation(other.kp, task.address)], ['etny-so', await noticeRow(task, 0)]], pem);
  assert.deepEqual(await session.pollOutputs(), []);
  assert.equal(session._taskWallet(), null);
});

test('an attestation for another order is ignored', async () => {
  const { kp, pem } = certificate();
  const task = ethers.Wallet.createRandom();
  const session = sessionWith([['etny-sw', attestation(kp, task.address, 2021)], ['etny-so', await noticeRow(task, 0)]], pem);
  assert.deepEqual(await session.pollOutputs(), []);
});

test('the attestation is verified with the certificate the handle was made with, whatever the runner reads afterwards', async () => {
  const { kp, pem } = certificate();
  const later = certificate();
  const task = ethers.Wallet.createRandom();
  // Signed with the key of the handle's certificate: accepted after the
  // runner has read another certificate for another trustedzone, and another
  // for the session's own.
  const session = sessionWith([['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(task, 0)]], pem);
  reads(session.runner, NETWORK, OTHER_ZONE, later.pem);
  reads(session.runner, NETWORK, ZONE, later.pem);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [0]);
  assert.equal(session._taskWallet(), task.address);
  // Signed with the key of the certificate the runner reads afterwards: ignored.
  const other = sessionWith([['etny-sw', attestation(later.kp, task.address)], ['etny-so', await noticeRow(task, 0)]], pem);
  reads(other.runner, NETWORK, ZONE, later.pem);
  assert.deepEqual(await other.pollOutputs(), []);
  assert.equal(other._taskWallet(), null);
});

test('a handle that holds no certificate leaves the attestation row unread, and reads on from it once the runner has read the certificate of the session\'s trustedzone on the session\'s network', async () => {
  const { kp, pem } = certificate();
  const stranger = certificate();
  const task = ethers.Wallet.createRandom();
  const rows = [['another-key', 'a row'], ['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(task, 0)]];
  const runner = runnerOver(rows);
  const session = new EthernityCloudSession(runner, ORDER, ZONE);
  session.dpReq = 9;
  const events = [];
  runner.dispatchECEvent = (message) => { events.push(message); };
  const waits = () => events.filter((message) => /holds no trustedzone certificate to check the task wallet attestation with/.test(message)).length;

  // The runner has read nothing: the read stops at the attestation row.
  assert.equal(session.certificate, '');
  assert.deepEqual(await session.pollOutputs(), []);
  assert.equal(session.rowsSeen, 1);
  assert.equal(waits(), 1);
  // A certificate the runner read on another network for a trustedzone of
  // the same name, and one it read on the session's network for another
  // trustedzone, are not the session's.
  reads(runner, OTHER_NETWORK, ZONE, stranger.pem);
  assert.deepEqual(await session.pollOutputs(), []);
  reads(runner, NETWORK, OTHER_ZONE, stranger.pem);
  assert.deepEqual(await session.pollOutputs(), []);
  assert.equal(session.certificate, '');
  assert.equal(session.rowsSeen, 1);
  // The wait is reported once.
  assert.equal(waits(), 1);
  // The runner reads the session's certificate, and then another trustedzone's
  // before the handle is asked: the handle takes its own, checks the
  // attestation row and delivers the output after it.
  reads(runner, NETWORK, ZONE, pem);
  reads(runner, NETWORK, OTHER_ZONE, stranger.pem);
  assert.equal(runner.enclavePublicKey, stranger.pem);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [0]);
  assert.equal(session.certificate, pem);
  assert.equal(session._taskWallet(), task.address);
  assert.equal(session.rowsSeen, 3);
});

test('a handle is made with the certificate the runner read on the handle\'s network for the handle\'s trustedzone, and with none when it read no such one', () => {
  const { pem } = certificate();
  const stranger = certificate();
  // What a handle of ZONE holds when it is made after the runner's `read`s.
  const made = (...read) => {
    const runner = runnerOver([]);
    for (const [network, trustedZone, certificatePem] of read) reads(runner, network, trustedZone, certificatePem);
    return new EthernityCloudSession(runner, ORDER, ZONE).certificate;
  };
  assert.equal(made([NETWORK, ZONE, pem]), pem);
  // The runner's later reads do not change what it read for the handle.
  assert.equal(made([NETWORK, ZONE, pem], [NETWORK, OTHER_ZONE, stranger.pem], [OTHER_NETWORK, ZONE, stranger.pem]), pem);
  assert.equal(made([OTHER_NETWORK, ZONE, stranger.pem]), '');
  assert.equal(made([NETWORK, OTHER_ZONE, stranger.pem]), '');
  assert.equal(made(), '');
});

test('a handle made with two arguments is of the trustedzone of the runner\'s last registry read', () => {
  const { pem } = certificate();
  const stranger = certificate();
  // The runner last read ZONE on its own network: the handle is ZONE's, with
  // the certificate of that read.
  const runner = runnerOver([]);
  reads(runner, NETWORK, ZONE, pem);
  const session = new EthernityCloudSession(runner, ORDER);
  assert.equal(session.trustedZone, ZONE);
  assert.equal(session.certificate, pem);
  // The runner last read on another network: the handle, on the runner's
  // network, holds no certificate of that read.
  const moved = runnerOver([]);
  reads(moved, NETWORK, ZONE, pem);
  reads(moved, OTHER_NETWORK, OTHER_ZONE, stranger.pem);
  const elsewhere = new EthernityCloudSession(moved, ORDER);
  assert.equal(elsewhere.network, NETWORK);
  assert.equal(elsewhere.trustedZone, OTHER_ZONE);
  assert.equal(elsewhere.certificate, '');
  // A runner that has read nothing.
  assert.equal(new EthernityCloudSession(runnerOver([]), ORDER).certificate, '');
});

test('an output not signed by the attested wallet is discarded', async () => {
  const { kp, pem } = certificate();
  const task = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const session = sessionWith([['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(other, 0)],
    ['etny-so', await noticeRow(task, 1)]], pem);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [1]);
});
