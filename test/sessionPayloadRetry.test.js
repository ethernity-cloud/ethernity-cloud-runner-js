// EthernityCloudSession: a verified output row whose payload is not readable
// yet, or is served under its CID with other bytes, is read again on later
// polls and delivered once the payload is, for PAYLOAD_RETRY_MS; a row whose
// payload never comes is given up after that, and the rows behind it go on
// (bloxberg testnet order 2023: output 3's payload reached the gateway after
// the row and was discarded as a digest mismatch). No chain, no IPFS, no NaCl:
// the contract, the fetch and the decryption are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsrsasign from 'jsrsasign';
import { ethers } from 'ethers';
import { EthernityCloudSession, PAYLOAD_RETRY_MS } from '../session.js';
import { sha256 } from '../crypto.js';

const ORDER = 2022;
const PAYLOAD = 'sealed reply bytes';
const CID = 'bafkreibobnv5ikag6zekcsihz2nsckfjg32uacwd3o6shtu3u7rxi3ot2m';

const certificate = () => {
  const kp = jsrsasign.KEYUTIL.generateKeypair('EC', 'secp384r1');
  const pem = new jsrsasign.KJUR.asn1.x509.Certificate({
    version: 3, serial: { int: 1 }, issuer: { str: '/CN=trustedzone' }, subject: { str: '/CN=trustedzone' },
    notbefore: '250101000000Z', notafter: '350101000000Z', sbjpubkey: kp.pubKeyObj, sigalg: 'SHA256withECDSA', cakey: kp.prvKeyObj
  }).getPEM();
  const attestation = (wallet) => {
    const signature = new jsrsasign.KJUR.crypto.Signature({ alg: 'SHA256withECDSA' });
    signature.init(kp.prvKeyObj);
    signature.updateString(`etny-sw|${ORDER}|${wallet}`);
    return `v1:${ORDER}:${wallet}:${signature.sign()}`;
  };
  return { pem, attestation };
};

const outputRow = async (signer, seq, cid = CID, payload = PAYLOAD) => {
  const shaHex = sha256(payload);
  const sig = await signer.signMessage(`etny-so|${ORDER}|${seq}|${seq}|ok|0|${cid}|${shaHex}`);
  return `v1:${seq}:${ORDER}:${seq}:ok:0:${cid}:${shaHex}:${sig}`;
};

// A session over `rows` whose payload fetch answers `served[cid]` from the
// `serveFrom`-th request on and throws before, as getFromIPFS does when no
// endpoint serves the CID, and whose decryption is a stamp.
const sessionWith = async (rowsOf, served, serveFrom = 1) => {
  const { pem, attestation } = certificate();
  const task = ethers.Wallet.createRandom();
  const rows = [['etny-sw', attestation(task.address)]];
  for (const row of rowsOf) rows.push(['etny-so', await row(task)]);
  const contract = {
    _getMetadataCountForDPRequest: async () => rows.length,
    _getMetadataValueForDPRequest: async (dpReq, i) => rows[i]
  };
  const runner = { protocolContract: { getContract: () => contract }, enclavePublicKey: pem, dispatchECEvent: () => {} };
  const session = new EthernityCloudSession(runner, ORDER);
  session.dpReq = 9;
  session.doReq = 7;
  let requests = 0;
  session._fetchPayload = async (cid) => {
    requests += 1;
    if (requests < serveFrom || !(cid in served)) throw new Error(`${cid} not served`);
    return served[cid];
  };
  session._decryptPayload = (content) => ({ success: true, data: `reply:${content}` });
  return { session, served };
};

test('a payload served later is delivered on a later poll', async () => {
  const { session } = await sessionWith([(t) => outputRow(t, 0)], { [CID]: PAYLOAD }, 3);
  assert.deepEqual(await session.pollOutputs(), []);
  assert.deepEqual(await session.pollOutputs(), []);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.data), [`reply:${PAYLOAD}`]);
  assert.deepEqual(session.payloadWaits, {});
});

test('bytes that do not hash to the digest are read again', async () => {
  const { session, served } = await sessionWith([(t) => outputRow(t, 0)], { [CID]: 'other bytes' });
  assert.deepEqual(await session.pollOutputs(), []);
  served[CID] = PAYLOAD;
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [0]);
});

test('the rows behind a pending payload wait for it in order', async () => {
  const { session } = await sessionWith([(t) => outputRow(t, 0), (t) => outputRow(t, 1)], { [CID]: PAYLOAD }, 2);
  assert.deepEqual(await session.pollOutputs(), []);
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [0, 1]);
});

test('a payload that never comes is given up after the retry window', async () => {
  const other = 'bafkreifgxs3pym3dkwr3uuio75l56jooxni3joe7vqcgb7jtjdguhirhle';
  const { session } = await sessionWith([(t) => outputRow(t, 0, other, 'never'), (t) => outputRow(t, 1)], { [CID]: PAYLOAD });
  assert.deepEqual(await session.pollOutputs(), []);
  session.payloadWaits[1] -= PAYLOAD_RETRY_MS + 1;
  assert.deepEqual((await session.pollOutputs()).map((m) => m.seq), [1]);
});
