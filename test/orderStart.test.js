// The start of an order: a node that advertises 'startrow=v1' in its DP
// request's metadata4 adds an etny-st row, 'v1:<order>:<block>', when it begins
// running the order; the runner treats an order of such a node without the row
// ORDER_START_WINDOW_BLOCKS blocks into processing as abandoned (bloxberg
// testnet, 2026-10-24: a node that skipped an approved order left its client
// waiting the order's full duration).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_STARTED_KEY, ORDER_START_WINDOW_BLOCKS, orderStartVerdict, startedRowAdvertised, startedRowOrder } from '../runner.js';

test('a DP request advertises started rows as one metadata4 entry', () => {
  assert.equal(startedRowAdvertised('trustedzones=etny-pynithy-testnet;ipfs=12D3KooW;startrow=v1'), true);
  assert.equal(startedRowAdvertised('trustedzones=etny-pynithy-testnet;ipfs=12D3KooW'), false);
  assert.equal(startedRowAdvertised(''), false);
  assert.equal(startedRowAdvertised(undefined), false);
});

test('a started row names its order; other shapes name none', () => {
  assert.equal(startedRowOrder('v1:2053:30783036'), 2053);
  for (const value of ['', null, 'v1:2053', 'v2:2053:1', 'v1:order:1', 'v1:2053:block', '2053:1:v1']) {
    assert.equal(startedRowOrder(value), null, value);
  }
});

test('the verdict is started once a row names the order, whatever else the DP request holds', () => {
  const rows = [['etny-sw', 'v1:2053:0xabc:sig'], [ORDER_STARTED_KEY, 'v1:2052:100'], [ORDER_STARTED_KEY, 'v1:2053:101']];
  assert.equal(orderStartVerdict(rows, 2053, 120, 111), 'started');
  assert.equal(ORDER_START_WINDOW_BLOCKS, 10);
});

test('the verdict is waiting inside the window and late past it', () => {
  const rows = [[ORDER_STARTED_KEY, 'v1:2052:100']];
  assert.equal(orderStartVerdict(rows, 2053, 111, 111), 'waiting');
  assert.equal(orderStartVerdict(rows, 2053, 112, 111), 'late');
  assert.equal(orderStartVerdict([], 2053, 112, 111), 'late');
});
