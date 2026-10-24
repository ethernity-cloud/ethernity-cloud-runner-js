// EthernityCloudRunner.readOrder: the read of an order placed moments ago is
// retried while the RPC reverts it (a replica without the placing block yet),
// for ORDER_READ_RETRY_MS, and the last error is thrown after that (bloxberg
// testnet, 2026-10-24: one of ten concurrent runs failed on the read right
// after its _orderPlacedEV). The clock and the timers are node:test's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EthernityCloudRunner, { ORDER_READ_POLL_MS, ORDER_READ_RETRY_MS } from '../runner.js';

const ORDER = ['0xdowner', '0xnode', 7, 9, 1];

// A runner over a contract whose _getOrder reverts `revertsFor` reads, then
// answers; LOCAL mode skips the wallet.
const runnerWith = (revertsFor) => {
  const runner = new EthernityCloudRunner('LOCAL');
  let reads = 0;
  runner.protocolContract = {
    getContract: () => ({
      _getOrder: async () => {
        reads += 1;
        if (reads <= revertsFor) throw Object.assign(new Error('missing revert data'), { shortMessage: 'missing revert data' });
        return ORDER;
      },
    }),
  };
  runner.dispatchECEvent = () => {};
  return { runner, reads: () => reads };
};

// Lets a started read run up to its wait for the next attempt.
const settle = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };

test('an order whose read reverts at first is read on a later attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { runner, reads } = runnerWith(2);
  const read = runner.readOrder(2040);
  for (let i = 0; i < 2; i++) {
    await settle();
    t.mock.timers.tick(ORDER_READ_POLL_MS);
  }
  assert.deepEqual(await read, ORDER);
  assert.equal(reads(), 3);
});

test('an order that stays unreadable fails with the last error once the time is up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { runner } = runnerWith(Infinity);
  const read = runner.readOrder(2040);
  for (let i = 0; i <= ORDER_READ_RETRY_MS / ORDER_READ_POLL_MS; i++) {
    await settle();
    t.mock.timers.tick(ORDER_READ_POLL_MS);
  }
  await assert.rejects(read, /missing revert data/);
});
