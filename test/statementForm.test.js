// The etny-sw row's statement form (spec/matching.md 3.7, SF19; OD10 B) on
// reserved-prefixes.json (test/fixtures/): the statement form's bytes, its
// signed etny-sw example verified under capability-record.json's trustedzone
// test key, and the cut rule for the row: on a network whose pricing names a
// PoxMatching only the statement form verifies, so a plain-form row, the form
// of a trustedzone built before the statement form, is refused there; on any
// other network both forms verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import jsrsasign from 'jsrsasign';
import { STATEMENT_PREFIX, statementBytes, verifyCertificateSignature } from '../crypto.js';
import { EthernityCloudSession } from '../session.js';
import { load } from './specCopies.js';

const FORM = load('reserved-prefixes.json').statementForm;
const KEY = load('capability-record.json').trustedzoneKey;
const EXAMPLE = FORM.examples.find((e) => e.name === 'etny-sw');
const [, ORDER_TEXT, WALLET] = EXAMPLE.statement.split('|');
const ORDER = Number(ORDER_TEXT);

// A certificate over the trustedzone test key, as the Image Registry holds a
// trustedzone's.
const CERTIFICATE = new jsrsasign.KJUR.asn1.x509.Certificate({
  version: 3, serial: { int: 1 }, issuer: { str: '/CN=trustedzone' }, subject: { str: '/CN=trustedzone' },
  notbefore: '250101000000Z', notafter: '350101000000Z', sbjpubkey: jsrsasign.KEYUTIL.getKey(KEY.publicKeyPem),
  sigalg: 'SHA256withECDSA', cakey: jsrsasign.KEYUTIL.getKey(KEY.privateKeyPem)
}).getPEM();

// The example's etny-sw row signed over the statement's UTF-8 bytes.
const plainRow = () => {
  const signature = new jsrsasign.KJUR.crypto.Signature({ alg: 'SHA256withECDSA' });
  signature.init(jsrsasign.KEYUTIL.getKey(KEY.privateKeyPem));
  signature.updateHex(Buffer.from(EXAMPLE.statement, 'utf8').toString('hex'));
  return `v1:${ORDER}:${WALLET}:${signature.sign()}`;
};

const runnerOf = (rows, matchingNetwork) => {
  const contract = {
    _getMetadataCountForDPRequest: async () => rows.length,
    _getMetadataValueForDPRequest: async (dpReq, i) => rows[i]
  };
  const runner = {
    protocolContract: { getContract: () => contract },
    enclavePublicKey: CERTIFICATE,
    dispatchECEvent: () => {},
    matchingReads: 0,
    matchingNetwork,
    async namesPoxMatching() {
      this.matchingReads += 1;
      if (this.matchingNetwork instanceof Error) throw this.matchingNetwork;
      return this.matchingNetwork;
    }
  };
  return runner;
};

const attested = async (row, matchingNetwork) => {
  const runner = runnerOf([['etny-sw', row]], matchingNetwork);
  const session = new EthernityCloudSession(runner, ORDER);
  session.dpReq = 9;
  await session.pollOutputs();
  return { wallet: session.attestedWallet, runner, session };
};

test('the statement form\'s bytes and the signed etny-sw example', () => {
  assert.equal(Buffer.from(STATEMENT_PREFIX).toString('hex'), FORM.prefixHex);
  assert.equal(createHash('sha256').update(statementBytes(EXAMPLE.statement)).digest('hex'), EXAMPLE.statementBytesSha256);
  assert.equal(verifyCertificateSignature(CERTIFICATE, statementBytes(EXAMPLE.statement), EXAMPLE.signatureDerHex), true);
  assert.equal(verifyCertificateSignature(CERTIFICATE, EXAMPLE.statement, EXAMPLE.signatureDerHex), false);
  assert.equal(EXAMPLE.row, `v1:${ORDER}:${WALLET}:${EXAMPLE.signatureDerHex}`);
});

for (const matchingNetwork of [true, false]) {
  test(`a statement-form row is attested on a network ${matchingNetwork ? 'whose pricing names' : 'naming no'} PoxMatching`, async () => {
    const { wallet, runner } = await attested(EXAMPLE.row, matchingNetwork);
    assert.equal(wallet, WALLET);
    assert.equal(runner.matchingReads, 1);
  });
}

test('a plain-form row is refused on a matching network and attested elsewhere', async () => {
  const rule = FORM.cutRule.rows.find((r) => r.statement === 'etny-sw row');
  assert.equal(rule.matchingNetwork, 'the statement form only');
  assert.equal((await attested(plainRow(), true)).wallet, null);
  assert.equal((await attested(plainRow(), false)).wallet, WALLET);
});

test('a failed read of the network leaves the row for the next poll', async () => {
  const runner = runnerOf([['etny-sw', EXAMPLE.row]], new Error('no answer'));
  const session = new EthernityCloudSession(runner, ORDER);
  session.dpReq = 9;
  assert.deepEqual(await session.pollOutputs(), []);
  assert.deepEqual([session.attestedWallet, session.rowsSeen], [null, 0]);
  runner.matchingNetwork = true;
  await session.pollOutputs();
  assert.deepEqual([session.attestedWallet, session.rowsSeen], [WALLET, 1]);
});
