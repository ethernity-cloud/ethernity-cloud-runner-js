// The protocol check of a run (runner.verifyProtocol), which run() and
// runSession() make after the balance check and before the node check: the
// PoX's _getOrdersCount, a read every PoX generation carries. A PoX apart
// from the token (PolygonProtocolContract) answers it from its
// EthernityCloudStorage; bloxberg mainnet's PoX, the token's own proxy
// (BloxbergProtocolContract), answers it from its own state and names no
// storage. A read that answers lets the run go on. A read that fails on a PoX
// its storage does not list as an allowed caller
// (PolygonProtocolContract.storageAdmission) ends the run at once with the
// out-of-service message and the advice to upgrade the runner, before the
// allowance step: the wallet is asked for no approval of such a contract. Any
// other failure is tried READ_ATTEMPTS times READ_RETRY_MS apart, each failed
// try before the last a WARNING event, and then reported with the contract's
// address and the provider's message (utils.providerMessage). The storage
// refuses a read made through a PoX it does not list with "Allowed caller:
// caller is not allowed"; bloxberg's RPC returns that revert data in a form
// ethers does not read ("Reverted 0x..." as the error's data), so ethers
// reports "missing revert data" and keeps the RPC's answer in the error's
// info.error.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ECAddress, ECLog, ECStatus } from '../enums.js';
import PolygonProtocolContract from '../contract/operation/polygonProtocolContract.js';
import BloxbergProtocolContract from '../contract/operation/bloxbergProtocolContract.js';
import etnyAbi from '../contract/abi/etnyAbi.js';
import protocolAbi from '../contract/abi/polygonProtocolAbi.js';
import { READ_ATTEMPTS, READ_RETRY_MS } from '../utils.js';

const WALLET = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';
// A node of the bloxberg testnet, for the runs that name their node.
const NODE = '0x837EA0A09612CFF93a787db84Bbe11c65E431133';
const TOKEN = ECAddress.BLOXBERG.TESTNET_ADDRESS;
const POX = ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS;
const MAINNET = ECAddress.BLOXBERG.MAINNET_ADDRESS;
// The EthernityCloudStorage the bloxberg testnet's PoX names.
const STORAGE = '0xEE3aAa1A7a8C00BeBBb5DfC570F80f6FA12a968d';
// The selector of _getOrdersCount().
const ORDERS_COUNT = '0x246439e6';
const RESOURCES = { taskPrice: 3, validators: 1, duration: 1 };
const ALLOWED_CALLERS = new ethers.Interface(['function allowedCallers(address) view returns (bool)']);
const coder = ethers.AbiCoder.defaultAbiCoder();

const CHECKING = 'Checking the protocol contract...';
const OUT_OF_SERVICE = `The protocol contract ${POX} is out of service: its storage ${STORAGE} does not list it as an allowed caller, so every call through it is refused. That is the state of a contract another one has replaced: upgrade @ethernity-cloud/runner to a release that carries the network's current contract.`;
const unanswered = (pox, reason) => `The protocol contract ${pox} did not answer the read of its order count (${reason}).`;
// The WARNING event of a failed try that is followed by another.
const retrying = (attempt, reason) => [`Protocol contract read failed (try ${attempt} of 3), retrying: ${reason}`, ECLog.WARNING];

// The browser's network error as fetch throws it, and as a browser wallet
// relays it under its own JSON-RPC error.
const fetchFailed = () => new TypeError('Failed to fetch');
const relayed = () => ({ code: -32603, message: 'Internal JSON-RPC error.', data: { message: 'Failed to fetch' } });
const FETCH_FAILED = 'Failed to fetch';
// The bloxberg RPC's error answer to an eth_call the storage refuses: the
// revert data, Error("Allowed caller: caller is not allowed"), after the word
// "Reverted".
const NOT_ALLOWED = {
  code: -32015,
  message: 'VM execution error.',
  data: `Reverted ${new ethers.Interface(['error Error(string)']).encodeErrorResult('Error', ['Allowed caller: caller is not allowed'])}`
};
const VM_EXECUTION_ERROR = 'VM execution error.';
// A wallet's rejection of a request its user refuses.
const userRejected = () => ({ code: 4001, message: 'User rejected the request.' });

// A browser wallet (an EIP-1193 provider) on the bloxberg testnet holding
// WALLET: every other request is answered by `answer`, given the request's
// method and first parameter, or rejected with what it throws.
const browserWallet = (answer) => ({
  request: async ({ method, params }) => {
    if (method === 'eth_chainId') return '0x2323';
    if (method === 'eth_accounts') return [WALLET];
    return answer(method, params && params[0]);
  }
});

// The error ethers throws for the PoX's order count read when a browser
// wallet rejects the eth_call with `reject()`.
const callException = async (reject) => {
  const provider = new ethers.BrowserProvider(browserWallet(() => { throw reject(); }));
  try {
    const pox = new ethers.Contract(POX, protocolAbi.abi, provider);
    return await pox._getOrdersCount().then(() => assert.fail('answered'), (e) => e);
  } finally {
    provider.destroy();
  }
};
const RELAYED_EXCEPTION = await callException(relayed);
const NOT_ALLOWED_EXCEPTION = await callException(() => NOT_ALLOWED);

// A read answering `answers` in turn, the last one from then on; an Error
// among them is thrown. `calls` lists the arguments of the reads.
const reading = (answers) => {
  const read = async (...args) => {
    const answer = answers[Math.min(read.calls.length, answers.length - 1)];
    read.calls.push(args);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  read.calls = [];
  return read;
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

// The outcome of `start()` on faked timers: the clock is advanced by
// READ_RETRY_MS, the pause between the tries of the check, until the outcome
// settles.
const throughRetries = async (start) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let settled = false;
    const pending = start().finally(() => { settled = true; });
    pending.catch(() => {});
    for (let advances = 0; !settled; advances += 1) {
      assert.ok(advances < 100, 'the check did not settle');
      await settle();
      mock.timers.tick(READ_RETRY_MS);
    }
    return await pending;
  } finally {
    mock.timers.reset();
  }
};

// A runner whose protocol contract is at POX and answers its order count with
// `read`; `protocol` holds the other members of its class (storageAdmission).
// Its events are recorded as [message, level].
const runnerWith = (read, protocol = {}) => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.events = [];
  runner.dispatchECEvent = (message, level) => runner.events.push([message, level]);
  runner.protocolContract = { getContract: () => ({ _getOrdersCount: read, getAddress: async () => POX }), ...protocol };
  return runner;
};

// What storageAdmission answers for a PoX its storage does not list, for one
// it lists, and when a read of the two fails.
const NOT_LISTED = { storage: STORAGE, admitted: false };
const LISTED = { storage: STORAGE, admitted: true };
const UNREAD = null;

test('a PoX that answers its order count passes the check: one read, its storage not asked', async () => {
  const read = reading([162n]);
  const storageAdmission = reading([NOT_LISTED]);
  const runner = runnerWith(read, { storageAdmission });
  await runner.verifyProtocol();
  assert.equal(read.calls.length, 1);
  assert.equal(storageAdmission.calls.length, 0);
  assert.deepEqual(runner.events, [[CHECKING, undefined]]);
});

test('a failed read on a PoX its storage does not list ends the check at once with the out-of-service message: one read, no pause, no other try', async () => {
  const read = reading([NOT_ALLOWED_EXCEPTION]);
  const storageAdmission = reading([NOT_LISTED]);
  const runner = runnerWith(read, { storageAdmission });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // The clock stands still: a check that pauses before it ends loses to settle().
    const outcome = await Promise.race([runner.verifyProtocol().then(() => 'passed', (e) => e), settle().then(() => 'paused')]);
    assert.ok(outcome instanceof Error, `the check ${outcome}`);
    assert.equal(outcome.message, OUT_OF_SERVICE);
    assert.equal(outcome.cause, NOT_ALLOWED_EXCEPTION);
  } finally {
    mock.timers.reset();
  }
  assert.equal(read.calls.length, 1);
  assert.equal(storageAdmission.calls.length, 1);
  assert.deepEqual(runner.events, [[CHECKING, undefined]]);
});

test('a read that fails and then answers passes the check, the failed try a WARNING event naming the provider\'s message', async () => {
  // A storage that lists the PoX, one whose answer cannot be read, and a class without storageAdmission.
  for (const protocol of [{ storageAdmission: async () => LISTED }, { storageAdmission: async () => UNREAD }, {}]) {
    const read = reading([RELAYED_EXCEPTION, 162n]);
    const runner = runnerWith(read, protocol);
    await throughRetries(() => runner.verifyProtocol());
    assert.equal(read.calls.length, 2);
    assert.deepEqual(runner.events, [[CHECKING, undefined], retrying(1, FETCH_FAILED)]);
  }
});

test('a read that fails three times ends the check with the contract\'s address and the provider\'s message, the last error its cause', async () => {
  assert.equal(READ_ATTEMPTS, 3);
  for (const protocol of [{ storageAdmission: async () => LISTED }, { storageAdmission: async () => UNREAD }, {}]) {
    // ethers reports the second and the third as "missing revert data"; each is named by its provider's message.
    const errors = [fetchFailed(), NOT_ALLOWED_EXCEPTION, RELAYED_EXCEPTION];
    const read = reading(errors);
    const runner = runnerWith(read, protocol);
    await assert.rejects(throughRetries(() => runner.verifyProtocol()), (e) => {
      assert.equal(e.message, unanswered(POX, FETCH_FAILED));
      assert.equal(e.cause, errors[2]);
      return true;
    });
    assert.equal(read.calls.length, 3);
    assert.deepEqual(runner.events, [[CHECKING, undefined], retrying(1, FETCH_FAILED), retrying(2, VM_EXECUTION_ERROR)]);
  }
  for (const exception of [NOT_ALLOWED_EXCEPTION, RELAYED_EXCEPTION]) {
    assert.equal(exception.code, 'CALL_EXCEPTION');
    assert.equal(exception.shortMessage, 'missing revert data');
  }
});

test('the tries of the check are READ_RETRY_MS apart', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const read = reading([fetchFailed(), 162n]);
    const pending = runnerWith(read).verifyProtocol();
    await settle();
    assert.equal(read.calls.length, 1);
    // One millisecond short of the pause the read is not tried again.
    mock.timers.tick(READ_RETRY_MS - 1);
    await settle();
    assert.equal(read.calls.length, 1);
    mock.timers.tick(1);
    await pending;
    assert.equal(read.calls.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test('the storage is asked at every failed try: one that answers at the second try ends the check there', async () => {
  const errors = [fetchFailed(), NOT_ALLOWED_EXCEPTION];
  const read = reading(errors);
  const storageAdmission = reading([UNREAD, NOT_LISTED]);
  const runner = runnerWith(read, { storageAdmission });
  await assert.rejects(throughRetries(() => runner.verifyProtocol()), (e) => {
    assert.equal(e.message, OUT_OF_SERVICE);
    assert.equal(e.cause, errors[1]);
    return true;
  });
  assert.equal(read.calls.length, 2);
  assert.equal(storageAdmission.calls.length, 2);
  assert.deepEqual(runner.events, [[CHECKING, undefined], retrying(1, FETCH_FAILED)]);
});

// A runner on the network of `address` over a provider whose call() is
// `call`, its events discarded.
const runnerOn = async (address, call) => {
  const provider = { getNetwork: async () => ({ chainId: 8995n }), call };
  const runner = new EthernityCloudRunner(address, { provider, signer: { getAddress: async () => WALLET, provider } });
  runner.dispatchECEvent = () => {};
  await runner.resolveNetworkContext();
  return runner;
};

test('both protocol contract classes read _getOrdersCount (0x246439e6) at their own address, and an answer passes the check', async () => {
  for (const [address, Class, pox] of [[TOKEN, PolygonProtocolContract, POX], [MAINNET, BloxbergProtocolContract, MAINNET]]) {
    const calls = [];
    const runner = await runnerOn(address, async (tx) => {
      calls.push([tx.to, tx.data]);
      return coder.encode(['uint256'], [162n]);
    });
    assert.ok(runner.protocolContract instanceof Class);
    await runner.verifyProtocol();
    assert.deepEqual(calls, [[pox, ORDERS_COUNT]]);
  }
  assert.equal(ethers.id('_getOrdersCount()').slice(0, 10), ORDERS_COUNT);
});

test('bloxberg mainnet\'s PoX, the token\'s own proxy, has no storage to ask: its failed read is tried three times and reported with the provider\'s message', async () => {
  const calls = [];
  const runner = await runnerOn(MAINNET, async (tx) => {
    calls.push([tx.to, tx.data]);
    throw fetchFailed();
  });
  assert.equal(typeof runner.protocolContract.storageAdmission, 'undefined');
  await assert.rejects(throughRetries(() => runner.verifyProtocol()), { message: unanswered(MAINNET, FETCH_FAILED) });
  assert.deepEqual(calls, [[MAINNET, ORDERS_COUNT], [MAINNET, ORDERS_COUNT], [MAINNET, ORDERS_COUNT]]);
});

// The contracts of the chain below by address: a name, and the interface
// their functions are named with.
const CONTRACTS = {
  [TOKEN]: ['tETNY', new ethers.Interface(etnyAbi.abi)],
  [POX]: ['PoX', new ethers.Interface(protocolAbi.abi)],
  [STORAGE]: ['storage', ALLOWED_CALLERS]
};

// A browser wallet over a chain where WALLET holds 751 tETNY and no allowance
// for the PoX, and the PoX's storage lists the PoX or not (`listed`): the
// order count of a PoX it does not list is refused as the bloxberg RPC
// answers (NOT_ALLOWED). The wallet answers eth_blockNumber and
// eth_estimateGas and rejects every other request, eth_sendTransaction among
// them, with a user's rejection (userRejected, code 4001). `requests` lists
// the requests in order, a call or a transaction with its contract and
// function.
const chainWallet = (listed) => {
  const requests = [];
  const calls = {
    'tETNY.balanceOf': () => coder.encode(['uint256'], [ethers.parseEther('751')]),
    'tETNY.allowance': () => coder.encode(['uint256'], [0n]),
    'PoX._getOrdersCount': () => {
      if (!listed) throw NOT_ALLOWED;
      return coder.encode(['uint256'], [162n]);
    },
    'PoX.ethStorageAddress': () => coder.encode(['address'], [STORAGE]),
    'storage.allowedCallers': () => coder.encode(['bool'], [listed])
  };
  const wallet = browserWallet((method, tx) => {
    const [name, iface] = (tx && tx.to && CONTRACTS[ethers.getAddress(tx.to)]) || [];
    const called = name ? `${name}.${iface.getFunction(tx.data.slice(0, 10)).name}` : null;
    requests.push(called ? `${method} ${called}` : method);
    if (method === 'eth_call' && calls[called]) return calls[called]();
    if (method === 'eth_blockNumber') return '0x10';
    if (method === 'eth_estimateGas') return '0xb2ab';
    throw userRejected();
  });
  wallet.requests = requests;
  return wallet;
};

// A runner on the bloxberg testnet over `wallet` through ethers'
// BrowserProvider, as a browser dApp builds it, its events recorded.
const runnerOver = (wallet) => {
  const provider = new ethers.BrowserProvider(wallet);
  const runner = new EthernityCloudRunner(TOKEN, { provider });
  runner.events = [];
  runner.dispatchECEvent = (message) => runner.events.push(message);
  return { runner, provider };
};

test('a run and a session on a PoX its storage does not list, naming a node or none, end with the out-of-service message after the balance read: the wallet is asked for no read of the node\'s requests, no allowance read and no approval', async () => {
  // Each start with no node named, the fourth argument's default, and with NODE named.
  for (const [start, node] of [['run'], ['runSession'], ['run', NODE], ['runSession', NODE]]) {
    const label = node ? `${start} naming ${node}` : start;
    const wallet = chainWallet(false);
    const { runner, provider } = runnerOver(wallet);
    try {
      await assert.rejects(runner[start](RESOURCES, 'demo', 'code', node), (e) => {
        assert.equal(e.message, OUT_OF_SERVICE);
        // ethers reads no revert data from the RPC's answer and keeps the answer in info.error.
        assert.equal(e.cause.code, 'CALL_EXCEPTION');
        assert.equal(e.cause.shortMessage, 'missing revert data');
        assert.deepEqual(e.cause.info.error, NOT_ALLOWED);
        return true;
      });
    } finally {
      provider.destroy();
    }
    assert.deepEqual(wallet.requests, [
      'eth_call tETNY.balanceOf', 'eth_call PoX._getOrdersCount', 'eth_call PoX.ethStorageAddress', 'eth_call storage.allowedCallers'
    ], label);
    assert.deepEqual(runner.events, ['Checking wallet balance....', CHECKING, OUT_OF_SERVICE], label);
    assert.equal(runner.status, ECStatus.ERROR);
  }
});

test('on a PoX its storage lists, a run and a session that name no node go on to the node check and the allowance step, where the wallet is asked for the approval', async () => {
  for (const start of ['run', 'runSession']) {
    const wallet = chainWallet(true);
    const { runner, provider } = runnerOver(wallet);
    // The image registry is a contract outside this chain.
    runner.initializeImageRegistry = async () => {};
    try {
      await assert.rejects(runner[start](RESOURCES, 'demo', 'code'), { code: 'ACTION_REJECTED' });
    } finally {
      provider.destroy();
    }
    assert.deepEqual(wallet.requests.filter((request) => request.startsWith('eth_call')), [
      'eth_call tETNY.balanceOf', 'eth_call PoX._getOrdersCount', 'eth_call tETNY.allowance'
    ], start);
    assert.equal(wallet.requests.at(-1), 'eth_sendTransaction tETNY.approve', start);
    assert.deepEqual(runner.events.slice(0, 6), [
      'Checking wallet balance....',
      CHECKING,
      'Verifying node address...',
      'Checking allowance on the current wallet...',
      `Allowance for ${POX}: 0.0 tokens, 3 required`,
      'Approving allowance for 3 tokens'
    ], start);
  }
});
