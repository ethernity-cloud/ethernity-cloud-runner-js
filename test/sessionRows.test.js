// A session's etny-si rows by the grammar of spec/matching.md section 20
// (SF20; session-rows.json in test/fixtures/): the rows the runner writes are
// in the grammar (session.inputRow, session.closeRow), the rows it reads are
// read by it (session.sessionRow: the accepted and refused rows of the
// fixture, each read for its order), and the seq a handle resumes at is the
// next one the enclave takes after the request's rows (session.nextInputSeq,
// the fixture's row list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EthernityCloudSession, SESSION_INPUT_KEY, SessionError, UINT64_MAX, closeRow, inputRow, nextInputSeq, sessionRow
} from '../session.js';
import { load } from './specCopies.js';

const ROWS = load('session-rows.json');
const ORDER = ROWS.order;
const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy';
const SHA = 'dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f';

// A sessionRow answer in the fixture's terms: [kind, seq or depth].
const kindOf = (read) => {
  if (read === null) return [null, null];
  return read.kind === 'input' ? ['input', read.seq.toString()] : ['close', read.depth];
};

for (const row of ROWS.accepted) {
  test(`an accepted row is read: ${row.name}`, () => {
    const { expected } = row;
    assert.deepEqual(kindOf(sessionRow(row.value, ORDER)), [expected.kind, expected.kind === 'input' ? expected.seq : expected.depth]);
  });
}

for (const row of ROWS.refused) {
  test(`a refused row is not read: ${row.name}`, () => {
    assert.equal(row.expected.kind, null);
    assert.equal(sessionRow(row.value, ORDER), null);
  });
}

test('the row list resumes at the seq the enclave takes next', () => {
  const { list } = ROWS;
  const taken = list.outcome.filter((o) => o.read === 'taken');
  assert.deepEqual(taken.map((o) => o.value), list.taken);
  assert.equal(nextInputSeq(list.rows, ORDER), taken.length);
  assert.equal(taken.length, 4);
  for (const o of list.outcome) {
    assert.equal(sessionRow(o.value, ORDER) === null, ['outsideGrammar', 'otherOrder'].includes(o.read), o.value);
  }
  assert.equal(nextInputSeq(list.rows.slice(0, 2), ORDER), 1);
});

for (const seq of [0, 12, UINT64_MAX]) {
  test(`the input row the runner writes for seq ${seq} is in the grammar`, () => {
    const row = inputRow(seq, ORDER, CID, SHA);
    assert.deepEqual(kindOf(sessionRow(row, ORDER)), ['input', seq.toString()]);
    assert.equal(row, ROWS.accepted.find((r) => r.name === 'input').value.replace('v1:0:', `v1:${seq}:`));
  });
}

test('the close row the runner writes is in the grammar', () => {
  assert.equal(closeRow(ORDER), ROWS.accepted.find((r) => r.name === 'close').value);
  assert.deepEqual(sessionRow(closeRow(ORDER), ORDER), { kind: 'close', depth: null });
});

test('a value outside the grammar is refused before a row is written', () => {
  for (const args of [[-1, ORDER, CID, SHA], [UINT64_MAX + 1n, ORDER, CID, SHA], [1.5, ORDER, CID, SHA], ['0', ORDER, CID, SHA],
    [0, -1, CID, SHA], [0, ORDER, 'a:b', SHA], [0, ORDER, CID, 'a:b']]) {
    assert.throws(() => inputRow(...args), SessionError, String(args));
  }
  assert.throws(() => closeRow(UINT64_MAX + 1n), SessionError);
});

// A runner over the request's rows `rows` whose sends are kept in `sent`.
const runnerOver = (rows, sent) => {
  const addMetadata = async (doReq, key, value) => { sent.push([key, value]); return { hash: '0xrow' }; };
  addMetadata.estimateGas = async () => 100000n;
  const contract = {
    _getDORequest: async () => [null, 1n, 1n, 10n, 1n, 1n, 3n, 1n],
    _getOrder: async () => [null, null, 12n, 9n, 1n],
    _getMetadataCountForRequest: async () => rows.length,
    _getMetadataValueForRequest: async (doReq, i) => rows[i],
    _addMetadataToRequest: addMetadata
  };
  return {
    protocolContract: {
      getContract: () => contract,
      getProvider: () => ({ send: async () => ({ status: '0x1', blockNumber: '0x1', logs: [] }) })
    },
    readOrder: async () => [null, null, 12n, 9n, 1n],
    _sealArtefact: async () => ({ cid: CID, digest: SHA }),
    dispatchECEvent: () => {}
  };
};

test('a handle resumes at the seq the enclave takes, sends seq 4 and 5 in the grammar and writes its close row', async () => {
  const rows = ROWS.list.rows.map((value) => [SESSION_INPUT_KEY, value]);
  const sent = [];
  const session = await EthernityCloudSession.create(runnerOver(rows, sent), ORDER);
  assert.equal(session.inputSeq, 4);
  session._lodgeInput = async () => true;
  assert.deepEqual([await session.sendInput('a'), await session.sendInput('b')], [4, 5]);
  const written = sent.map(([, value]) => value);
  assert.deepEqual(written.map((v) => kindOf(sessionRow(v, ORDER))), [['input', '4'], ['input', '5']]);
  assert.equal(nextInputSeq([...ROWS.list.rows, ...written], ORDER), 6);
  await session.close(false);
  assert.deepEqual(sent[2], [SESSION_INPUT_KEY, closeRow(ORDER)]);
});
