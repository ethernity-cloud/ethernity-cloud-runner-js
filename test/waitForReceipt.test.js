// utils.waitForReceipt: a transaction's receipt polled through the provider's
// raw RPC, waiting through a null answer and a failing read, the logs parsed
// with the contract interface, a reverted transaction an error, and the last
// error thrown once the time is up (bloxberg testnet, 2026-10-25: ethers'
// TransactionResponse.wait() ended two of ten client processes within seconds
// when a lagging RPC replica answered its transaction lookup with nothing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { waitForReceipt } from '../utils.js';

const iface = new ethers.Interface(['event _addDORequestEV(address _from, uint256 _rowNumber)']);
const HASH = `0x${'11'.repeat(32)}`;
const receiptWith = (status, logs = []) => ({ status, blockNumber: '0x1f', logs });

// A provider whose eth_getTransactionReceipt gives `answers` in turn, the last
// one from then on; an Error among them is thrown.
const providerAnswering = (answers) => {
  let calls = 0;
  return {
    send: async () => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    calls: () => calls,
  };
};

test('a receipt not there yet, or that a replica fails to serve, is waited for, and its logs come parsed', async () => {
  const log = iface.encodeEventLog('_addDORequestEV', [`0x${'ab'.repeat(20)}`, 4349n]);
  const provider = providerAnswering([null, new Error('replica'), receiptWith('0x1', [{ ...log, address: `0x${'00'.repeat(20)}` }])]);
  const errors = [];
  const receipt = await waitForReceipt(provider, HASH, { iface, pollMs: 1, onError: (e) => errors.push(e.message) });
  assert.equal(receipt.status, 1);
  assert.equal(receipt.blockNumber, 31);
  assert.equal(receipt.hash, HASH);
  assert.equal(receipt.logs[0].eventName, '_addDORequestEV');
  assert.equal(receipt.logs[0].args[1], 4349n);
  assert.deepEqual(errors, ['replica']);
  assert.equal(provider.calls(), 3);
});

test('a reverted transaction is an error', async () => {
  await assert.rejects(waitForReceipt(providerAnswering([receiptWith('0x0')]), HASH, { pollMs: 1 }), /reverted/);
});

test('a transaction never seen fails once the time is up, with the last error when there was one', async () => {
  await assert.rejects(waitForReceipt(providerAnswering([new Error('replica')]), HASH, { pollMs: 1, timeoutMs: 20 }), /replica/);
  await assert.rejects(waitForReceipt(providerAnswering([null]), HASH, { pollMs: 1, timeoutMs: 20 }), /not mined within/);
});

test('a log of another contract stays raw and a receipt without status counts as mined', async () => {
  const foreign = { topics: [`0x${'ff'.repeat(32)}`], data: '0x', address: `0x${'01'.repeat(20)}` };
  const receipt = await waitForReceipt(providerAnswering([receiptWith(undefined, [foreign])]), HASH, { iface, pollMs: 1 });
  assert.equal(receipt.status, 1);
  assert.equal(receipt.logs[0].eventName, undefined);
  assert.equal(receipt.logs[0].topics[0], foreign.topics[0]);
});
