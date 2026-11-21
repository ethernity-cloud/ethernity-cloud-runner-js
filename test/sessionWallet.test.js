// EthernityCloudSession: output rows are verified against the task wallet the
// trustedzone attests in the session's 'etny-sw' row, which the runner checks
// with the trustedzone's certificate. An output row before any attestation, an
// attestation that does not verify, and an output not signed by the attested
// wallet are refused. No chain: the contract is a stand-in; the certificate
// and the wallets are made here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsrsasign from 'jsrsasign';
import { ethers } from 'ethers';
import { EthernityCloudSession } from '../session.js';
import { verifyCertificateSignature } from '../crypto.js';

const ORDER = 2022;

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

// A handle on the metadata `rows` of its DP request, made on a runner that
// holds the certificate `pem`; `network` and `trustedZone`, when given, are
// the runner's network descriptor and the trustedzone of the session's order.
const sessionWith = (rows, pem, { network, trustedZone } = {}) => {
  const contract = {
    _getMetadataCountForDPRequest: async () => rows.length,
    _getMetadataValueForDPRequest: async (dpReq, i) => rows[i]
  };
  const runner = { protocolContract: { getContract: () => contract }, networkConfig: network, enclavePublicKey: pem, dispatchECEvent: () => {} };
  const session = new EthernityCloudSession(runner, ORDER, trustedZone);
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

test('the attestation is verified with the certificate the handle was made with, whatever certificate the runner holds afterwards', async () => {
  const { kp, pem } = certificate();
  const later = certificate();
  const task = ethers.Wallet.createRandom();
  // Signed with the key of the handle's certificate: accepted while the
  // runner holds another one.
  const session = sessionWith([['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(task, 0)]], pem);
  session.runner.enclavePublicKey = later.pem;
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [0]);
  assert.equal(session._taskWallet(), task.address);
  // Signed with the key of the certificate the runner holds afterwards: ignored.
  const other = sessionWith([['etny-sw', attestation(later.kp, task.address)], ['etny-so', await noticeRow(task, 0)]], pem);
  other.runner.enclavePublicKey = later.pem;
  assert.deepEqual(await other.pollOutputs(), []);
  assert.equal(other._taskWallet(), null);
});

test('a handle that holds no certificate leaves the attestation row unread, and reads on from it once the runner holds the certificate of the session\'s trustedzone read on the session\'s network', async () => {
  const { kp, pem } = certificate();
  const task = ethers.Wallet.createRandom();
  const rows = [['another-key', 'a row'], ['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(task, 0)]];
  const network = { networkKey: 'POLYGON' };
  const session = sessionWith(rows, '', { network, trustedZone: 'ecld-pynithy-amoy' });
  const events = [];
  session.runner.dispatchECEvent = (message) => { events.push(message); };
  const waits = () => events.filter((message) => /holds no trustedzone certificate to check the task wallet attestation with/.test(message)).length;

  // No certificate: the read stops at the attestation row.
  assert.equal(session.certificate, '');
  assert.deepEqual(await session.pollOutputs(), []);
  assert.equal(session.rowsSeen, 1);
  assert.equal(waits(), 1);
  // The runner holds a certificate it read on another network: not the session's.
  Object.assign(session.runner, { enclavePublicKey: pem, enclaveDetailsNetwork: { networkKey: 'POLYGON' }, enclaveDetailsTrustedZone: 'ecld-pynithy-amoy' });
  assert.deepEqual(await session.pollOutputs(), []);
  // ... one it read on the session's network for another trustedzone: not the session's.
  Object.assign(session.runner, { enclaveDetailsNetwork: network, enclaveDetailsTrustedZone: 'ecld-pynithy-amoy-unsafe' });
  assert.deepEqual(await session.pollOutputs(), []);
  assert.equal(session.certificate, '');
  assert.equal(session.rowsSeen, 1);
  // The wait is reported once.
  assert.equal(waits(), 1);
  // The one it read on the session's network for the session's trustedzone:
  // the attestation row is checked and the output after it delivered.
  session.runner.enclaveDetailsTrustedZone = 'ecld-pynithy-amoy';
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [0]);
  assert.equal(session.certificate, pem);
  assert.equal(session._taskWallet(), task.address);
  assert.equal(session.rowsSeen, 3);
});

test('a handle is made with the runner\'s certificate only when the runner read it on the handle\'s network for the handle\'s trustedzone', () => {
  const { pem } = certificate();
  const network = { networkKey: 'POLYGON' };
  const made = (held) => {
    const runner = { protocolContract: { getContract: () => ({}) }, networkConfig: network, enclavePublicKey: pem, dispatchECEvent: () => {}, ...held };
    return new EthernityCloudSession(runner, ORDER, 'ecld-pynithy-amoy').certificate;
  };
  assert.equal(made({ enclaveDetailsNetwork: network, enclaveDetailsTrustedZone: 'ecld-pynithy-amoy' }), pem);
  assert.equal(made({ enclaveDetailsNetwork: { networkKey: 'POLYGON' }, enclaveDetailsTrustedZone: 'ecld-pynithy-amoy' }), '');
  assert.equal(made({ enclaveDetailsNetwork: network, enclaveDetailsTrustedZone: 'ecld-nodenithy-amoy' }), '');
  assert.equal(made({ enclaveDetailsNetwork: null, enclaveDetailsTrustedZone: null }), '');
});

test('an output not signed by the attested wallet is discarded', async () => {
  const { kp, pem } = certificate();
  const task = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const session = sessionWith([['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(other, 0)],
    ['etny-so', await noticeRow(task, 1)]], pem);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [1]);
});
