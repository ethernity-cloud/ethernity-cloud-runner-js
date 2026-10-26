// withGasHeadroom: a contract write is sent with the node's estimate plus
// GAS_HEADROOM_PERCENT as its gas limit, its arguments and overrides passed
// through (bloxberg testnet 2026-10-25: a session close sent at the bare
// estimate of 82782 gas reverted, the write needing 86982 once another
// transaction had reached the contract earlier in the block).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAS_HEADROOM_PERCENT, withGasHeadroom } from '../utils.js';

// A stand-in for an ethers contract method: callable, with estimateGas.
const method = (estimate) => {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return { hash: '0xsent' }; };
  fn.estimateGas = async (...args) => { fn.estimated = args; return estimate; };
  fn.calls = calls;
  return fn;
};

test('the gas limit is the estimate plus the headroom', async () => {
  assert.equal(GAS_HEADROOM_PERCENT, 25);
  const fn = method(82782n);
  const tx = await withGasHeadroom(fn, [7, 'etny-si', 'v1:close:2583']);
  assert.deepEqual(tx, { hash: '0xsent' });
  assert.deepEqual(fn.estimated, [7, 'etny-si', 'v1:close:2583', {}]);
  assert.deepEqual(fn.calls, [[7, 'etny-si', 'v1:close:2583', { gasLimit: 103477n }]]);
});

test('overrides reach the estimate and the send, under the gas limit', async () => {
  const fn = method(100n);
  await withGasHeadroom(fn, [1], { value: 5n });
  assert.deepEqual(fn.estimated, [1, { value: 5n }]);
  assert.deepEqual(fn.calls, [[1, { value: 5n, gasLimit: 125n }]]);
});
