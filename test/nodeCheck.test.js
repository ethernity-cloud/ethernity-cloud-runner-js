// The node check of a run that names its node (verifyNodeAddress ->
// isNodeOperatorAddress): the protocol contract's _getMyDPRequests read as a
// static call from the node's address. An answer decides: a node with a DP
// request passes, one with none is "not a valid node operator address". A
// read the contract or the RPC refuses decides nothing about the node and is
// reported as what it is: a PoX its storage no longer lists as an allowed
// caller (EthernityCloudStorage.allowedCallers, read through the
// implementation's ethStorageAddress) as retired, with the advice to upgrade
// the runner; any other failure with the contract's address and the RPC's
// message. bloxberg's RPC returns no revert text for such a read ("missing
// revert data"), so the storage's own "Allowed caller: caller is not allowed"
// never reaches the caller there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ECStatus } from '../enums.js';
import PolygonProtocolContract from '../contract/operation/polygonProtocolContract.js';
import BloxbergProtocolContract from '../contract/operation/bloxbergProtocolContract.js';

const NODE = '0x837EA0A09612CFF93a787db84Bbe11c65E431133';
const POX = '0x7E7C6eB435E3687CfDfe18C09C0340eb70567d7b';
const STORAGE = '0xEE3aAa1A7a8C00BeBBb5DfC570F80f6FA12a968d';
const NOT_AN_OPERATOR = 'Introduced address is not a valid node operator address.';

// ethers' error for a reverted eth_call whose RPC returns no revert data.
const missingRevertData = () => Object.assign(new Error('missing revert data (action="call", data=null, reason=null)'), {
  code: 'CALL_EXCEPTION',
  shortMessage: 'missing revert data',
});

// A runner whose protocol contract is `protocol` (with getContract answering POX), its events collected.
const runnerWith = (protocol) => {
  const runner = new EthernityCloudRunner('LOCAL');
  const events = [];
  runner.dispatchECEvent = (message) => events.push(message);
  runner.protocolContract = { getContract: () => ({ getAddress: async () => POX }), ...protocol };
  return { runner, events };
};

test('a node with a DP request passes the check and a node with none is not a valid node operator address', async () => {
  const asked = [];
  const { runner, events } = runnerWith({ isNodeOperator: async (account) => { asked.push(account); return true; } });
  assert.equal(await runner.isNodeOperatorAddress(NODE), true);
  assert.deepEqual(asked, [NODE]);
  assert.deepEqual(events, []);

  const none = runnerWith({ isNodeOperator: async () => false });
  await assert.rejects(none.runner.isNodeOperatorAddress(NODE), { message: NOT_AN_OPERATOR });
  assert.deepEqual(none.events, [NOT_AN_OPERATOR]);
  assert.equal(none.runner.status, ECStatus.ERROR);
});

test('no node address passes without a read, and a string that is no address is not a valid wallet address', async () => {
  const { runner } = runnerWith({ isNodeOperator: async () => { throw new Error('not to be called'); } });
  assert.equal(await runner.isNodeOperatorAddress(''), true);
  await assert.rejects(runner.isNodeOperatorAddress('0x1234'), { message: 'Introduced address is not a valid wallet address.' });
});

test('a refused read on a PoX its storage no longer admits is reported as a retired contract, with the storage and the advice to upgrade', async () => {
  const { runner, events } = runnerWith({
    isNodeOperator: async () => { throw missingRevertData(); },
    storageAdmission: async () => ({ storage: STORAGE, admitted: false }),
  });
  const expected = `The protocol contract ${POX} is retired: its storage ${STORAGE} no longer admits it, so every call through it is refused. Upgrade @ethernity-cloud/runner: this version carries an address a later contract replaced.`;
  await assert.rejects(runner.isNodeOperatorAddress(NODE), { message: expected });
  assert.deepEqual(events, [expected]);
  assert.equal(runner.status, ECStatus.ERROR);
  assert.ok(!expected.includes('not a valid node operator'));
});

test('a refused read on a PoX its storage admits, or whose admission cannot be read, is reported with the contract and the RPC\'s message', async () => {
  const generic = (reason) => `Could not verify the node address: the protocol contract ${POX} did not answer the read of the node's requests (${reason}).`;
  for (const storageAdmission of [async () => ({ storage: STORAGE, admitted: true }), async () => null]) {
    const { runner, events } = runnerWith({ isNodeOperator: async () => { throw missingRevertData(); }, storageAdmission });
    await assert.rejects(runner.isNodeOperatorAddress(NODE), { message: generic('missing revert data') });
    assert.deepEqual(events, [generic('missing revert data')]);
    assert.equal(runner.status, ECStatus.ERROR);
  }
  // A protocol contract class without storageAdmission (the token's own proxy), and an error without ethers' shortMessage.
  const legacy = runnerWith({ isNodeOperator: async () => { throw new Error('fetch failed'); } });
  await assert.rejects(legacy.runner.isNodeOperatorAddress(NODE), { message: generic('fetch failed') });
  assert.deepEqual(legacy.events, [generic('fetch failed')]);
});

// A provider bound to a static network makes no request when it is built.
const providerOn = (chainId) => new ethers.JsonRpcProvider('http://127.0.0.1:1', ethers.Network.from(chainId), { staticNetwork: true });

// `Class` built on POX with an offline provider, handed to `use`.
const withProtocol = async (Class, use) => {
  const provider = providerOn(8995);
  try {
    await use(new Class(POX, { provider, signer: ethers.Wallet.createRandom().connect(provider) }));
  } finally {
    provider.destroy();
  }
};

test('isNodeOperator of both protocol contract classes reads _getMyDPRequests from the node\'s address and throws what the read throws', async () => {
  for (const [Class, field] of [[PolygonProtocolContract, 'protocolContractWithProvider'], [BloxbergProtocolContract, 'etnyContactWithProvider']]) {
    await withProtocol(Class, async (protocol) => {
      const overrides = [];
      let answer = [7n];
      protocol[field] = { _getMyDPRequests: async (o) => { overrides.push(o); return answer; } };
      assert.equal(await protocol.isNodeOperator(NODE), true);
      answer = [];
      assert.equal(await protocol.isNodeOperator(NODE), false);
      assert.deepEqual(overrides, [{ from: NODE }, { from: NODE }]);
      protocol[field] = { _getMyDPRequests: async () => { throw missingRevertData(); } };
      await assert.rejects(protocol.isNodeOperator(NODE), { shortMessage: 'missing revert data' });
    });
  }
  await withProtocol(BloxbergProtocolContract, async (protocol) => {
    assert.equal(typeof protocol.storageAdmission, 'undefined');
  });
});

test('storageAdmission asks the storage the implementation names whether it lists the implementation, and is null when a read fails', async () => {
  const allowedCallers = new ethers.Interface(['function allowedCallers(address) view returns (bool)']);
  await withProtocol(PolygonProtocolContract, async (protocol) => {
    const calls = [];
    let admitted = false;
    protocol.protocolContractWithProvider = { ethStorageAddress: async () => STORAGE, getAddress: async () => POX };
    protocol.provider = {
      call: async (tx) => {
        calls.push(tx);
        return allowedCallers.encodeFunctionResult('allowedCallers', [admitted]);
      },
    };
    assert.deepEqual(await protocol.storageAdmission(), { storage: STORAGE, admitted: false });
    admitted = true;
    assert.deepEqual(await protocol.storageAdmission(), { storage: STORAGE, admitted: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].to, STORAGE);
    assert.equal(calls[0].data, allowedCallers.encodeFunctionData('allowedCallers', [POX]));

    protocol.provider = { call: async () => { throw new Error('fetch failed'); } };
    assert.equal(await protocol.storageAdmission(), null);
    protocol.protocolContractWithProvider = { ethStorageAddress: async () => { throw missingRevertData(); }, getAddress: async () => POX };
    assert.equal(await protocol.storageAdmission(), null);
  });
});
