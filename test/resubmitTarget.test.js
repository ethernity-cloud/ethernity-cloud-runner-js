// EthernityCloudRunner pins every DO request of a run to the node the caller
// asked for (requestedNodeAddress, '' for any node), a request resubmitted
// after an operator fault included, and approves the order of every open
// request. nodeAddress is the node of the current order, set from the order
// once it is approved; it decided the pinning before (bloxberg testnet,
// 2026-10-25: the request resubmitted after a dead node's order was pinned to
// that node, which no other node could place and the dead one did not).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EthernityCloudRunner from '../runner.js';

const NODE_OF_FIRST_ORDER = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';

// A runner whose contract records the node each DO request is pinned to, with
// the steps between the request and the result stubbed; the approval records
// the order's node as the real one does. LOCAL mode skips the wallet.
const runnerWith = () => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.dispatchECEvent = () => {};
  const pinned = [];
  let approvals = 0;
  runner.protocolContract = {
    isNodeOperator: async () => true,
    getContract: () => ({
      _getOrdersCount: async () => 0,
      interface: { parseLog: () => ({ name: '_addDORequestEV', args: ['0xclient', 4349n] }) },
    }),
    getProvider: () => ({ send: async () => ({ status: '0x1', blockNumber: '0x1', logs: [{ topics: [], data: '0x' }] }) }),
    addDORequest: async (image, code, input, node) => {
      pinned.push(node);
      return { hash: '0xtx' };
    },
  };
  runner.getV3ImageMetadata = async () => 'image';
  runner.getV3CodeMetadata = async () => 'code';
  runner.getV3InputMedata = async () => 'input';
  runner.findOrder = async () => { runner.orderId = 2107; };
  runner.approveOrder = async () => { approvals += 1; runner.nodeAddress = NODE_OF_FIRST_ORDER; };
  runner.waitforTaskToBeProcessed = async () => true;
  runner.getOrderResult = async () => { runner.result = { value: 'ok' }; };
  return { runner, pinned: () => pinned, approvals: () => approvals };
};

test('an open request is resubmitted open and its order approved, not pinned to the node of the failed order', async () => {
  const { runner, pinned, approvals } = runnerWith();
  await runner.verifyNodeAddress('');
  await runner.processTaskAttempt('code');
  assert.equal(runner.nodeAddress, NODE_OF_FIRST_ORDER);
  await runner.processTaskAttempt('code');
  assert.deepEqual(pinned(), ['', '']);
  assert.equal(approvals(), 2);
});

test('a request pinned by the caller is resubmitted to that node and never approved', async () => {
  const { runner, pinned, approvals } = runnerWith();
  await runner.verifyNodeAddress(NODE_OF_FIRST_ORDER);
  await runner.processTaskAttempt('code');
  await runner.processTaskAttempt('code');
  assert.deepEqual(pinned(), [NODE_OF_FIRST_ORDER, NODE_OF_FIRST_ORDER]);
  assert.equal(approvals(), 0);
});
