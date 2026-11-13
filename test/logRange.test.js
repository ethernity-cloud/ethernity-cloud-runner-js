// utils.queryFilterChunked: a contract's logs read over consecutive ranges of
// at most LOG_RANGE_BLOCKS blocks, the Zeeve RPC of the LiteForge testnet
// refusing a wider eth_getLogs range ("eth_getLogs range exceeds 3000 blocks;
// split the range"), and the runner's findOrder reading its placement logs
// through it: the catch-up over the recent past and the watcher's ticks, a
// tick that finds the head far ahead reading the gap chunk by chunk. The
// timers are node:test's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EthernityCloudRunner from '../runner.js';
import { LOG_RANGE_BLOCKS, queryFilterChunked } from '../utils.js';

const FILTER = { topics: ['0xplaced'] };

// A placement log at `blockNumber`, with the args of _orderPlacedEV as ethers
// gives them: positional and named.
const placedAt = (blockNumber, orderNumber, doRequestId) => ({
  blockNumber,
  args: Object.assign([BigInt(orderNumber), BigInt(doRequestId), 3n], {
    _orderNumber: BigInt(orderNumber),
    _doRequestId: BigInt(doRequestId),
    _dpRequestId: 3n
  })
});

// A contract whose queryFilter records each range it is asked for and answers
// with the logs among `logs` that the range holds; a range among `failing`
// (by its from block) throws instead.
const contractHolding = (logs = [], failing = []) => {
  const ranges = [];
  return {
    ranges,
    filters: { _orderPlacedEV: () => FILTER },
    queryFilter: async (filter, from, to) => {
      assert.equal(filter, FILTER);
      ranges.push([from, to]);
      if (failing.includes(from)) throw new Error(`range ${from}..${to} refused`);
      return logs.filter((log) => log.blockNumber >= from && log.blockNumber <= to);
    }
  };
};

test('the range limit is the 3000 blocks of the Zeeve RPC', () => {
  assert.equal(LOG_RANGE_BLOCKS, 3000);
});

test('a range within the limit is read in one call with its own bounds', async () => {
  const contract = contractHolding([placedAt(250, 7, 9)]);
  const logs = await queryFilterChunked(contract, FILTER, 100, 400);
  assert.deepEqual(contract.ranges, [[100, 400]]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].blockNumber, 250);
  await queryFilterChunked(contract, FILTER, 0, 2999);
  assert.deepEqual(contract.ranges[1], [0, 2999]);
  await queryFilterChunked(contract, FILTER, 500, 500);
  assert.deepEqual(contract.ranges[2], [500, 500]);
});

test('a range wider than the limit is read in consecutive ranges of at most 3000 blocks, the logs concatenated in order', async () => {
  const placed = [101, 3100, 3101, 9000, 10100].map((block, i) => placedAt(block, i + 1, 9));
  const contract = contractHolding(placed);
  const logs = await queryFilterChunked(contract, FILTER, 101, 10100);
  assert.deepEqual(contract.ranges, [[101, 3100], [3101, 6100], [6101, 9100], [9101, 10100]]);
  for (const [from, to] of contract.ranges) assert.ok(to - from + 1 <= LOG_RANGE_BLOCKS, `${from}..${to}`);
  assert.deepEqual(logs.map((log) => log.blockNumber), [101, 3100, 3101, 9000, 10100]);
  const oneOver = contractHolding();
  await queryFilterChunked(oneOver, FILTER, 0, 3000);
  assert.deepEqual(oneOver.ranges, [[0, 2999], [3000, 3000]]);
});

test('an empty range reads nothing', async () => {
  const contract = contractHolding([placedAt(5, 1, 9)]);
  assert.deepEqual(await queryFilterChunked(contract, FILTER, 5, 4), []);
  assert.deepEqual(contract.ranges, []);
});

test('a range the RPC refuses fails the read, with no log of the ranges before it', async () => {
  const contract = contractHolding([placedAt(10, 1, 9)], [3000]);
  await assert.rejects(queryFilterChunked(contract, FILTER, 0, 7000), /range 3000\.\.5999 refused/);
  assert.deepEqual(contract.ranges, [[0, 2999], [3000, 5999]]);
});

// Lets the started reads run up to their next timer.
const settle = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };

test('findOrder reads the placement logs in ranges within the limit: the catch-up, and a watcher tick that finds the head far ahead', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The head is 100 until the catch-up and the watcher's first tick have read
  // it, then 10100; the order was placed at block 9000, in the gap.
  let head = 100;
  const contract = contractHolding([placedAt(9000, 7, 9)]);
  const runner = new EthernityCloudRunner('LOCAL');
  const events = [];
  runner.dispatchECEvent = (message) => events.push(message);
  runner.protocolContract = {
    getContract: () => contract,
    getProvider: () => ({ getBlockNumber: async () => head })
  };
  runner.doRequest = 9;
  runner.orderWaitSeconds = 600;
  runner.readOrder = async (orderId) => ({ orderId, doRequest: 9 });

  const found = runner.findOrder();
  for (let i = 0; i < 8 && contract.ranges.length < 2; i++) await settle();
  await settle();
  assert.deepEqual([...contract.ranges].sort((a, b) => a[0] - b[0]), [[0, 100], [100, 100]]);
  head = 10100;
  t.mock.timers.tick(4000);
  assert.equal(await found, true);

  assert.equal(runner.orderId, 7);
  assert.deepEqual(runner.order, { orderId: 7, doRequest: 9 });
  assert.deepEqual(contract.ranges.slice(2), [[101, 3100], [3101, 6100], [6101, 9100], [9101, 10100]]);
  for (const [from, to] of contract.ranges) assert.ok(to - from + 1 <= LOG_RANGE_BLOCKS, `${from}..${to}`);
  assert.ok(events.includes('_orderPlacedEV: order 7 for request 9'));
});
