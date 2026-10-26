// EthernityCloudSession.awaitOutput: the output answering one input, by the
// row's ack, however many outputs for other inputs arrive around it (bloxberg
// testnet order 2583: the answers to inputs 7 and 8 reached the chain ten
// minutes late, after the client had given up on them, and waitOutputs
// handed the first of them over as the answer to input 9). No chain, no
// IPFS, no NaCl: the contract, the fetch and the decryption are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsrsasign from 'jsrsasign';
import { ethers } from 'ethers';
import { EthernityCloudSession } from '../session.js';
import { sha256 } from '../crypto.js';

const ORDER = 2583;
// The CID of the payload answering input `ack`: content-derived in the
// protocol, so one per answer here too.
const cidOf = (ack) => `bafkreib${String(ack).padStart(51, 'a')}`;

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

// The 'ok' output row `seq` answering input `ack`, its payload "reply to <ack>".
const outputRow = async (signer, seq, ack) => {
  const payload = `reply to ${ack}`;
  const shaHex = sha256(payload);
  const sig = await signer.signMessage(`etny-so|${ORDER}|${seq}|${ack}|ok|0|${cidOf(ack)}|${shaHex}`);
  return `v1:${seq}:${ORDER}:${ack}:ok:0:${cidOf(ack)}:${shaHex}:${sig}`;
};

// A session whose chain holds the attestation row and the rows `answer` adds
// over time; the payload fetch serves each answer's bytes under its CID.
const sessionWith = async () => {
  const { pem, attestation } = certificate();
  const task = ethers.Wallet.createRandom();
  const rows = [['etny-sw', attestation(task.address)]];
  const contract = {
    _getMetadataCountForDPRequest: async () => rows.length,
    _getMetadataValueForDPRequest: async (dpReq, i) => rows[i]
  };
  const runner = { protocolContract: { getContract: () => contract }, enclavePublicKey: pem, dispatchECEvent: () => {} };
  const session = new EthernityCloudSession(runner, ORDER);
  session.dpReq = 9;
  session.doReq = 7;
  const payloads = {};
  session._fetchPayload = async (cid) => payloads[cid];
  session._decryptPayload = (content) => ({ success: true, data: content });
  const answer = async (seq, ack) => {
    payloads[cidOf(ack)] = `reply to ${ack}`;
    rows.push(['etny-so', await outputRow(task, seq, ack)]);
  };
  return { session, answer };
};

test('the answer to the input is returned, not an earlier input\'s late answer', async () => {
  const { session, answer } = await sessionWith();
  await answer(0, 7);
  await answer(1, 8);
  await answer(2, 9);
  const msg = await session.awaitOutput(9, 1000, 1);
  assert.equal(msg.ack, 9);
  assert.equal(msg.data, 'reply to 9');
  assert.deepEqual(session.outputs.map((m) => m.ack), [7, 8, 9]);
});

test('an answer that arrived during an earlier wait is found without polling', async () => {
  const { session, answer } = await sessionWith();
  await answer(0, 7);
  await answer(1, 8);
  assert.equal((await session.awaitOutput(7, 1000, 1)).data, 'reply to 7');
  session._contract()._getMetadataCountForDPRequest = async () => { throw new Error('no chain read expected'); };
  assert.equal((await session.awaitOutput(8, 1000, 1)).data, 'reply to 8');
});

test('no answer within the timeout is null', async () => {
  const { session, answer } = await sessionWith();
  await answer(0, 0);
  assert.equal(await session.awaitOutput(1, 20, 5), null);
  assert.deepEqual(session.outputs.map((m) => m.ack), [0]);
});
