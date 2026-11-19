// The node check of a run that names its node (verifyNodeAddress ->
// isNodeOperatorAddress): the protocol contract's _getMyDPRequests read as a
// static call from the node's address, in the 0x-prefixed EIP-55 form
// whatever the spelling the run names it in (utils.normalizeNodeAddress). An
// answer decides: a node with a DP request passes, one with none is "not a
// valid node operator address". A read the contract or the RPC refuses
// decides nothing about the node and is reported as what it is: a PoX its
// storage does not list as an allowed caller
// (EthernityCloudStorage.allowedCallers, read through the implementation's
// ethStorageAddress) as out of service, with the storage and the advice to
// upgrade the runner; any other failure with the contract's address and the
// provider's message (utils.providerMessage). The storage refuses a read
// made through a PoX it does not list with "Allowed caller: caller is not
// allowed"; bloxberg's RPC returns that revert data in a form ethers does not
// read ("Reverted 0x..." as the error's data), so ethers reports "missing
// revert data" and keeps the RPC's answer in the error's info.error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ECStatus } from '../enums.js';
import PolygonProtocolContract from '../contract/operation/polygonProtocolContract.js';
import BloxbergProtocolContract from '../contract/operation/bloxbergProtocolContract.js';
import { normalizeNodeAddress } from '../utils.js';

const NODE = '0x837EA0A09612CFF93a787db84Bbe11c65E431133';
const POX = '0x7E7C6eB435E3687CfDfe18C09C0340eb70567d7b';
const STORAGE = '0xEE3aAa1A7a8C00BeBBb5DfC570F80f6FA12a968d';
const NOT_AN_OPERATOR = 'Introduced address is not a valid node operator address.';
const OUT_OF_SERVICE = `The protocol contract ${POX} is out of service: its storage ${STORAGE} does not list it as an allowed caller, so every call through it is refused. That is the state of a contract another one has replaced: upgrade @ethernity-cloud/runner to a release that carries the network's current contract.`;
const unanswered = (reason) => `Could not verify the node address: the protocol contract ${POX} did not answer the read of the node's requests (${reason}).`;
// The selectors of ethStorageAddress() and _getMyDPRequests().
const ETH_STORAGE_ADDRESS = '0x9a8babce';
const MY_DP_REQUESTS = '0x4c1782e5';
const coder = ethers.AbiCoder.defaultAbiCoder();

// ethers' error for an eth_call it reads no revert data from, without the
// provider's answer (info).
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

// A runner whose protocol contract is `Class` itself, built on POX over `provider`, its events collected.
const runnerOver = (Class, provider) => {
  const { runner, events } = runnerWith({});
  runner.protocolContract = new Class(POX, { provider });
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

test('a refused read on a PoX its storage does not list is reported as a contract out of service, with the storage and the advice to upgrade', async () => {
  const refused = missingRevertData();
  const { runner, events } = runnerWith({
    isNodeOperator: async () => { throw refused; },
    storageAdmission: async () => ({ storage: STORAGE, admitted: false }),
  });
  await assert.rejects(runner.isNodeOperatorAddress(NODE), (e) => {
    assert.equal(e.message, OUT_OF_SERVICE);
    assert.equal(e.cause, refused);
    return true;
  });
  assert.deepEqual(events, [OUT_OF_SERVICE]);
  assert.equal(runner.status, ECStatus.ERROR);
  assert.ok(!OUT_OF_SERVICE.includes('not a valid node operator'));
});

test('a refused read on a PoX its storage lists, or whose listing cannot be read, is reported with the contract and the provider\'s message', async () => {
  for (const storageAdmission of [async () => ({ storage: STORAGE, admitted: true }), async () => null]) {
    const refused = missingRevertData();
    const { runner, events } = runnerWith({ isNodeOperator: async () => { throw refused; }, storageAdmission });
    await assert.rejects(runner.isNodeOperatorAddress(NODE), (e) => {
      assert.equal(e.message, unanswered('missing revert data'));
      assert.equal(e.cause, refused);
      return true;
    });
    assert.deepEqual(events, [unanswered('missing revert data')]);
    assert.equal(runner.status, ECStatus.ERROR);
  }
  // A protocol contract class without storageAdmission (the token's own proxy), and an error without ethers' shortMessage.
  const legacy = runnerWith({ isNodeOperator: async () => { throw new Error('fetch failed'); } });
  await assert.rejects(legacy.runner.isNodeOperatorAddress(NODE), { message: unanswered('fetch failed') });
  assert.deepEqual(legacy.events, [unanswered('fetch failed')]);
});

// The browser's network error as fetch throws it, as a browser wallet relays
// it under its own JSON-RPC error, and the bloxberg RPC's error answer to an
// eth_call the storage refuses: the revert data after the word "Reverted".
const fetchFailed = () => new TypeError('Failed to fetch');
const relayed = () => ({ code: -32603, message: 'Internal JSON-RPC error.', data: { message: 'Failed to fetch' } });
const notAllowed = () => ({
  code: -32015,
  message: 'VM execution error.',
  data: `Reverted ${new ethers.Interface(['error Error(string)']).encodeErrorResult('Error', ['Allowed caller: caller is not allowed'])}`
});

test('through a BrowserProvider over a wallet rejecting eth_call, ethers reports "missing revert data" and the message names the provider\'s own, kept in info.error', async () => {
  for (const [reject, reason] of [[fetchFailed, 'Failed to fetch'], [relayed, 'Failed to fetch'], [notAllowed, 'VM execution error.']]) {
    // A browser wallet (an EIP-1193 provider) on the bloxberg testnet holding NODE, its every other request rejected with `reject()`.
    const provider = new ethers.BrowserProvider({
      request: async ({ method }) => {
        if (method === 'eth_chainId') return '0x2323';
        if (method === 'eth_accounts') return [NODE];
        throw reject();
      }
    });
    const { runner, events } = runnerOver(PolygonProtocolContract, provider);
    try {
      await assert.rejects(runner.isNodeOperatorAddress(NODE), (e) => {
        assert.equal(e.message, unanswered(reason));
        assert.equal(e.cause.code, 'CALL_EXCEPTION');
        assert.equal(e.cause.shortMessage, 'missing revert data');
        assert.equal(e.cause.info.error.message, reject().message);
        return true;
      });
    } finally {
      provider.destroy();
    }
    assert.deepEqual(events, [unanswered(reason)]);
  }
});

test('a node check that fails ends verifyNodeAddress with the same error, and the run names no node', async () => {
  const refused = missingRevertData();
  for (const [storageAdmission, message] of [
    [async () => ({ storage: STORAGE, admitted: false }), OUT_OF_SERVICE],
    [async () => ({ storage: STORAGE, admitted: true }), unanswered('missing revert data')]
  ]) {
    const { runner, events } = runnerWith({ isNodeOperator: async () => { throw refused; }, storageAdmission });
    await assert.rejects(runner.verifyNodeAddress(NODE), (e) => {
      assert.equal(e.message, message);
      assert.equal(e.cause, refused);
      return true;
    });
    assert.deepEqual(events, ['Verifying node address...', message]);
    assert.equal(runner.status, ECStatus.ERROR);
    assert.equal(runner.requestedNodeAddress, '');
    assert.equal(runner.nodeAddress, '');
  }
});

test('normalizeNodeAddress is the 0x-prefixed EIP-55 form of an address in any spelling, \'\' for no node and for the zero address, and any other string trimmed', () => {
  for (const spelling of [NODE, NODE.toLowerCase(), NODE.slice(2), NODE.slice(2).toLowerCase(), `0x${NODE.slice(2).toUpperCase()}`, ` ${NODE.toLowerCase()}\n`]) {
    assert.equal(normalizeNodeAddress(spelling), NODE, spelling);
  }
  for (const none of ['', '   ', null, undefined, ethers.ZeroAddress, ethers.ZeroAddress.slice(2), ` ${ethers.ZeroAddress} `]) {
    assert.equal(normalizeNodeAddress(none), '', String(none));
  }
  // A string that is no address: too short, a name, and a mixed-case spelling whose checksum is wrong.
  const miscased = `0x837ea0${NODE.slice(8)}`;
  for (const [given, kept] of [['0x1234', '0x1234'], [' node.eth ', 'node.eth'], [miscased, miscased]]) {
    assert.equal(normalizeNodeAddress(given), kept);
  }
});

test('verifyNodeAddress reads from, and names as the run\'s node, the EIP-55 form of a node given in lowercase or without the 0x prefix, on both protocol contract classes', async () => {
  for (const Class of [PolygonProtocolContract, BloxbergProtocolContract]) {
    for (const spelling of [NODE, NODE.toLowerCase(), NODE.slice(2), NODE.slice(2).toLowerCase()]) {
      const calls = [];
      // The class's own ethers.Contract over a provider whose call() answers one DP request.
      const provider = { call: async (tx) => { calls.push(tx); return coder.encode(['uint256[]'], [[7n]]); } };
      const { runner } = runnerOver(Class, provider);
      await runner.verifyNodeAddress(spelling);
      assert.deepEqual(calls, [{ from: NODE, to: POX, data: MY_DP_REQUESTS }], spelling);
      assert.equal(runner.requestedNodeAddress, NODE);
      assert.equal(runner.nodeAddress, NODE);
    }
  }
  // The zero address names no node: nothing is read.
  const { runner } = runnerWith({ isNodeOperator: async () => { throw new Error('not to be called'); } });
  for (const none of ['', ethers.ZeroAddress, ethers.ZeroAddress.slice(2)]) {
    await runner.verifyNodeAddress(none);
    assert.equal(runner.requestedNodeAddress, '');
  }
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

test('storageAdmission asks the implementation for its storage (ethStorageAddress, 0x9a8babce), then that storage whether it lists the implementation, and is null when a read fails', async () => {
  const allowedCallers = new ethers.Interface(['function allowedCallers(address) view returns (bool)']);
  const calls = [];
  // The answers of the chain to the two reads, in order; an Error among them is thrown.
  let answers;
  // The class's own ethers.Contract over a provider whose call() is a stand-in.
  const protocol = new PolygonProtocolContract(POX, {
    provider: {
      call: async (tx) => {
        calls.push(tx);
        const answer = answers.shift();
        if (answer instanceof Error) throw answer;
        return answer;
      }
    }
  });
  const storage = coder.encode(['address'], [STORAGE]);
  const listed = (admitted) => allowedCallers.encodeFunctionResult('allowedCallers', [admitted]);
  const reads = [{ to: POX, data: ETH_STORAGE_ADDRESS }, { to: STORAGE, data: allowedCallers.encodeFunctionData('allowedCallers', [POX]) }];
  assert.equal(ethers.id('ethStorageAddress()').slice(0, 10), ETH_STORAGE_ADDRESS);

  answers = [storage, listed(false)];
  assert.deepEqual(await protocol.storageAdmission(), { storage: STORAGE, admitted: false });
  assert.deepEqual(calls, reads);
  answers = [storage, listed(true)];
  assert.deepEqual(await protocol.storageAdmission(), { storage: STORAGE, admitted: true });
  assert.deepEqual(calls.slice(2), reads);

  // The storage's read fails; the implementation's read fails; the implementation answers no address.
  for (const [failing, made] of [[[storage, new Error('fetch failed')], 2], [[missingRevertData()], 1], [['0x'], 1]]) {
    calls.length = 0;
    answers = failing;
    assert.equal(await protocol.storageAdmission(), null);
    assert.deepEqual(calls, reads.slice(0, made));
  }
});
