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

const sessionWith = (rows, pem) => {
  const contract = {
    _getMetadataCountForDPRequest: async () => rows.length,
    _getMetadataValueForDPRequest: async (dpReq, i) => rows[i]
  };
  const runner = { protocolContract: { getContract: () => contract }, enclavePublicKey: pem, dispatchECEvent: () => {} };
  const session = new EthernityCloudSession(runner, ORDER);
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

test('a handle made while the runner holds no certificate verifies with the one the runner reads on the session\'s network, and with no other network\'s', async () => {
  const { kp, pem } = certificate();
  const task = ethers.Wallet.createRandom();
  const rows = [['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(task, 0)]];
  const network = { networkKey: 'POLYGON' };
  const made = () => {
    const session = sessionWith(rows, '');
    session.network = network;
    return session;
  };
  // No certificate: the attestation cannot be verified.
  const without = made();
  assert.deepEqual(await without.pollOutputs(), []);
  assert.equal(without.certificate, '');
  // The runner holds a certificate it read on another network: not taken.
  const elsewhere = made();
  elsewhere.runner.enclavePublicKey = pem;
  elsewhere.runner.enclaveDetailsNetwork = { networkKey: 'POLYGON' };
  assert.deepEqual(await elsewhere.pollOutputs(), []);
  assert.equal(elsewhere.certificate, '');
  // The runner holds the certificate it read on the session's network: taken.
  const here = made();
  here.runner.enclavePublicKey = pem;
  here.runner.enclaveDetailsNetwork = network;
  assert.deepEqual((await here.pollOutputs()).map((m) => m.seq), [0]);
  assert.equal(here.certificate, pem);
});

test('an output not signed by the attested wallet is discarded', async () => {
  const { kp, pem } = certificate();
  const task = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const session = sessionWith([['etny-sw', attestation(kp, task.address)], ['etny-so', await noticeRow(other, 0)],
    ['etny-so', await noticeRow(task, 1)]], pem);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [1]);
});
