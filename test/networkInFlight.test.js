// setNetwork() and the operations in flight on a runner. A runner has one
// queue of operations: a run (run), a session start (runSession), an attach
// (attachSession), the task of a state read (esrRead) and a setNetwork()
// called while any of them is queued or in flight each take a turn, in the
// order of the calls. A run is on the network the runner is on when its turn
// comes, from its first step to its last: its registry reads, the spender of
// its allowance, its transactions, its order reads and its result read are
// that network's, and the trustedzone its request names is that network's. A
// setNetwork() called during it applies after it, and the operation called
// after that setNetwork() is on the network it names. With no operation
// queued or in flight, setNetwork() applies in the call. A session handle
// keeps the PoX, the network descriptor and the trustedzone certificate it
// was opened with.
//
// The chain is a stand-in at the provider: every eth_call, gas estimate,
// transaction and log read is recorded with the contract it is addressed to
// and answered from the state the transactions leave (a DO request, the order
// placed on it, its approval, its metadata rows). Two steps of a run are
// stood in for on the runner: _sealArtefact (the seal for the trustedzone's
// certificate and its upload), which records the network and the certificate
// it is called with, and getOrderResult (the result's download and
// decryption), which reads the result row through the protocol contract the
// runner holds at that step.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ECAddress, ECNetworkConfig, ECPox10TestnetConfig, ECRunner } from '../enums.js';
import { initialize } from '../ipfs.js';
import { configureHeldCache } from '../heldCache.js';
import etnyAbi from '../contract/abi/etnyAbi.js';
import ecldAbi from '../contract/abi/ecldAbi.js';
import protocolAbi from '../contract/abi/polygonProtocolAbi.js';
import registryAbi from '../contract/abi/imageRegistryAbi.js';

const WALLET = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';
const NODE = '0x837EA0A09612CFF93a787db84Bbe11c65E431133';
const SECURELOCK = 'my-securelock';
const RESOURCES = { taskPrice: 3, validators: 1, duration: 1 };
// Order statuses the stand-in chain answers: a session's order stays
// PROCESSING once approved, a task's order reads as closed.
const PROCESSING = 1;
const CLOSED = 2;
// The key the stand-in chain signs every order's result transaction with.
const ENCLAVE = ethers.Wallet.createRandom();

const AMOY_TOKEN = ECAddress.POLYGON.TESTNET_ADDRESS;
const BLOXBERG_TOKEN = ECAddress.BLOXBERG.TESTNET_ADDRESS;
const BLOXBERG_POX10_TOKEN = ECAddress.BLOXBERG.TESTNET_POX10_ADDRESS;

// The contracts of Polygon Amoy's two networks, by the label the recorded
// traffic names them with: the test ECLD both are paid in, and the PoX and
// the image registry of each.
const AMOY = {
  chainId: 80002,
  contracts: {
    token: [AMOY_TOKEN, ecldAbi.abi],
    pox20: [ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS, protocolAbi.abi],
    registry20: [ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS, registryAbi.abi],
    pox10: [ECAddress.POLYGON.AMOY_POX10_PROTOCOL_ADDRESS, protocolAbi.abi],
    registry10: [ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.AMOY_POX10_ADDRESS, registryAbi.abi]
  }
};
// The contracts of the bloxberg testnet's two networks: tETNY with the PoX
// 2.0 and its registry, and the PoX 1.0 network's proxy, token and PoX in
// one, with its registry.
const BLOXBERG = {
  chainId: 8995,
  contracts: {
    token: [BLOXBERG_TOKEN, etnyAbi.abi],
    pox20: [ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS, protocolAbi.abi],
    registry20: [ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS, registryAbi.abi],
    pox10: [BLOXBERG_POX10_TOKEN, etnyAbi.abi],
    registry10: [ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.TESTNET_POX10_ADDRESS, registryAbi.abi]
  }
};

// What a run on a network is expected to touch (onNetwork): its PoX and
// registry by label, the trustedzone it names by default, and the token the
// PoX is approved on where the PoX is apart from its token.
const AMOY_POX20 = { pox: 'pox20', registry: 'registry20', trustedZone: ECRunner.POLYGON.PYNITHY_RUNNER_TESTNET, token: 'token' };
const AMOY_POX10 = { pox: 'pox10', registry: 'registry10', trustedZone: ECRunner.POLYGON.PYNITHY_RUNNER_AMOY_POX10, token: 'token' };
const BLOXBERG_POX20 = { pox: 'pox20', registry: 'registry20', trustedZone: ECRunner.BLOXBERG.PYNITHY_RUNNER_TESTNET, token: 'token' };
const BLOXBERG_POX10 = { pox: 'pox10', registry: 'registry10', trustedZone: ECRunner.BLOXBERG.PYNITHY_RUNNER_TESTNET_POX10 };

// The certificate the stand-in registry `registry` holds for `trustedZone`.
const certificateOf = (trustedZone, registry) => `certificate of ${trustedZone} in ${registry}`;

const settle = () => new Promise((resolve) => setImmediate(resolve));

let heldDirectory = '';

before(async () => {
  heldDirectory = await mkdtemp(join(tmpdir(), 'etny-held-'));
  configureHeldCache({ directory: heldDirectory });
  // An IPFS API of the application's own is the storage in effect: it serves
  // every network. No request reaches it, _sealArtefact being stood in for.
  initialize('http://127.0.0.1:5001');
});

after(async () => {
  await rm(heldDirectory, { recursive: true, force: true });
});

// A chain holding `contracts` ({ label: [address, abi] }) on `chainId`:
// { provider, signer, log, at, during }. log is the traffic in the order it
// was made, one entry per eth_call ('call'), gas estimate ('estimate'),
// transaction ('send') and log read ('logs'), each with the label of the
// contract it is addressed to and, for the first three, the function's name
// and arguments. during(kind, name, run) calls run() once, at the first
// `kind` entry of the function `name`.
const chainOf = ({ chainId, contracts }) => {
  const byAddress = new Map(Object.entries(contracts).map(([label, [address, abi]]) => [
    address.toLowerCase(),
    { label, address, iface: new ethers.Interface(abi), requests: [], orders: [], placed: [] }
  ]));
  const at = (address) => {
    const contract = byAddress.get(String(address).toLowerCase());
    if (!contract) throw new Error(`no contract of this test at ${address}`);
    return contract;
  };
  const log = [];
  const receipts = new Map();
  const hooks = [];
  const record = (kind, tx) => {
    const contract = at(tx.to);
    const call = contract.iface.parseTransaction({ data: tx.data });
    if (!call) throw new Error(`${contract.label} has no function for ${tx.data.slice(0, 10)}`);
    const entry = { kind, label: contract.label, name: call.name, args: call.args };
    if (call.name === 'allowance') entry.spender = at(call.args[1]).label;
    if (call.name === 'approve') entry.spender = at(call.args[0]).label;
    log.push(entry);
    const hook = hooks.findIndex((h) => h.kind === kind && h.name === call.name);
    if (hook >= 0) hooks.splice(hook, 1)[0].run();
    return { contract, call };
  };
  const reverted = () => { throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' }); };
  // The result row of an order: 'v3:<result transaction>:<result CID>', the
  // transaction an _addResultToOrder call to the order's PoX, signed for the
  // chain by ENCLAVE.
  const resultRow = async (contract, orderId) => {
    const transaction = await ENCLAVE.signTransaction({
      type: 0,
      chainId,
      nonce: 0,
      gasLimit: 100000,
      gasPrice: 1,
      to: contract.address,
      data: contract.iface.encodeFunctionData('_addResultToOrder', [orderId, 'v3:0:checksum:enclave challenge'])
    });
    return `v3:${transaction}:QmResult`;
  };
  const answer = async ({ contract, call }) => {
    const request = () => contract.requests[Number(call.args[0])] || reverted();
    const order = () => contract.orders[Number(call.args[0])] || reverted();
    switch (call.name) {
      case 'balanceOf': return [ethers.parseEther('5000')];
      case 'allowance': return [0];
      case '_getOrdersCount': return [contract.orders.length];
      case '_getOrder': return [WALLET, NODE, order().doRequest, 0, order().status];
      case '_getDORequest': return [WALLET, 1, 1, 40, 1, request().duration, 3, 1];
      case '_getDORequestMetadata': return [WALLET, ...request().metadata];
      case '_getDPRequestMetadata': return [NODE, '', '', '', ''];
      case '_getMetadataCountForRequest': return [request().rows.length];
      case '_getMetadataValueForRequest': return request().rows[Number(call.args[1])];
      case '_getMetadataCountForDPRequest': return [0];
      case '_getResultFromOrder': return [await resultRow(contract, order() && call.args[0])];
      case 'getLatestTrustedZoneImageCertPublicKey':
        return ['QmTrustedZone', certificateOf(call.args[0], contract.label), 'QmTrustedZoneCompose'];
      case 'getLatestImageVersionPublicKey':
        return [`QmImage-${contract.label}`, 'certificate of the securelock', `QmCompose-${contract.label}`];
      default: throw new Error(`no answer of this test for ${call.name}`);
    }
  };
  const eventLog = (contract, name, values) => ({ address: contract.address, ...contract.iface.encodeEventLog(name, values) });
  // What a transaction leaves on its contract, and the logs of its receipt. A
  // DO request is given an order at once; a session's order (a request whose
  // input metadata is tagged v3s) is PROCESSING once approved, a task's
  // CLOSED.
  const effect = ({ contract, call }) => {
    const { requests, orders, placed } = contract;
    if (call.name === '_addDORequest') {
      const metadata = Array.from(call.args).slice(7).map(String);
      const request = requests.length;
      requests.push({ metadata, duration: Number(call.args[4]), session: metadata[2].startsWith('v3s:'), rows: [] });
      placed.push(eventLog(contract, '_orderPlacedEV', [orders.length, request, 0]));
      orders.push({ doRequest: request, status: 0 });
      return [eventLog(contract, '_addDORequestEV', [WALLET, request])];
    }
    if (call.name === '_approveOrder') {
      const order = orders[Number(call.args[0])];
      order.status = requests[order.doRequest].session ? PROCESSING : CLOSED;
      return [eventLog(contract, '_orderApprovedEV', [WALLET, NODE, call.args[0]])];
    }
    if (call.name === '_addMetadataToRequest') {
      requests[Number(call.args[0])].rows.push([call.args[1], call.args[2]]);
    }
    return [];
  };
  const provider = {
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    getBlockNumber: async () => 16,
    call: async (tx) => {
      const read = record('call', tx);
      return read.contract.iface.encodeFunctionResult(read.call.fragment, await answer(read));
    },
    estimateGas: async (tx) => {
      record('estimate', tx);
      return 100000n;
    },
    getLogs: async (filter) => {
      const contract = at(filter.address);
      log.push({ kind: 'logs', label: contract.label });
      return filter.topics[0] === contract.iface.getEvent('_orderPlacedEV').topicHash ? contract.placed : [];
    },
    send: async (method, [hash]) => {
      assert.equal(method, 'eth_getTransactionReceipt');
      return { status: '0x1', blockNumber: '0x10', logs: receipts.get(hash) };
    },
    getTransactionReceipt: async (hash) => ({ hash, status: 1, blockNumber: 16, logs: [] })
  };
  const signer = {
    provider,
    getAddress: async () => WALLET,
    sendTransaction: async (tx) => {
      const sent = record('send', tx);
      const hash = ethers.id(`transaction ${receipts.size}`);
      receipts.set(hash, effect(sent));
      return { hash };
    }
  };
  return { provider, signer, log, at, during: (kind, name, run) => hooks.push({ kind, name, run }) };
};

// A runner constructed with `token` on a chain of `network`, with the two
// stand-ins of the header. Its events are kept in runner.events; an 'end'
// entry closes each run's traffic in chain.log, once the event watchers the
// run started have made their reads.
const runnerOn = (network, token) => {
  const chain = chainOf(network);
  const runner = new EthernityCloudRunner(token, {
    provider: chain.provider,
    signer: chain.signer,
    encryptionPublicKey: 'ab'.repeat(32)
  });
  runner.events = [];
  runner.dispatchECEvent = (message) => { runner.events.push(message); };
  runner._sealArtefact = async (plaintext, cfg = runner.networkConfig, certificate = runner.enclavePublicKey) => {
    chain.log.push({ kind: 'seal', label: chain.at(cfg.protocolAddress).label, certificate });
    return { cid: `QmArtefact${chain.log.length}`, digest: 'digest' };
  };
  runner.getOrderResult = async () => {
    runner.result = await runner.protocolContract.getResultFromOrder(runner.orderId);
    await settle();
    chain.log.push({ kind: 'end' });
  };
  return { chain, runner };
};

const task = (runner) => runner.run(RESOURCES, SECURELOCK, 'code', '', null, { maxRetries: 0 });

// The traffic of each run in `log`, in order: the entries up to each 'end'.
const runsOf = (log) => {
  const runs = [[]];
  for (const entry of log) {
    if (entry.kind === 'end') runs.push([]);
    else runs[runs.length - 1].push(entry);
  }
  return runs.slice(0, -1);
};

const unique = (values) => [...new Set(values)];

// What `entries` of a chain's log touched: the transactions and the gas
// estimates as contract.function, in order; the spenders of the allowance
// reads and approvals; the registry reads with their first argument; the
// contracts read (eth_call and log reads); the image and the trustedzone
// each DO request names; the network and the certificate the artefacts were
// sealed for.
const traffic = (entries) => {
  const of = (kind) => entries.filter((entry) => entry.kind === kind);
  const named = (kind) => of(kind).map((entry) => `${entry.label}.${entry.name}`);
  return {
    sent: named('send'),
    estimated: named('estimate'),
    spenders: unique(entries.filter((entry) => entry.spender).map((entry) => entry.spender)),
    registry: of('call')
      .filter((entry) => entry.label.startsWith('registry'))
      .map((entry) => `${entry.label}.${entry.name}(${entry.args[0]})`),
    read: unique([...of('call'), ...of('logs')].map((entry) => entry.label)).sort(),
    requests: of('send')
      .filter((entry) => entry.name === '_addDORequest')
      .map((entry) => String(entry.args[7]).split(':').slice(1, 3).join(' ')),
    sealed: unique(of('seal').map((entry) => `${entry.label} ${entry.certificate}`))
  };
};

// The traffic of one run that is on `network` from its first step to its
// last.
const onNetwork = ({ pox, registry, trustedZone, token = null }) => ({
  sent: [...(token ? [`${token}.approve`] : []), `${pox}._addDORequest`, `${pox}._approveOrder`],
  estimated: [`${pox}._addDORequest`],
  spenders: token ? [pox] : [],
  registry: [
    `${registry}.getLatestTrustedZoneImageCertPublicKey(${trustedZone})`,
    `${registry}.getLatestImageVersionPublicKey(${SECURELOCK})`
  ],
  read: [pox, registry, ...(token ? [token] : [])].sort(),
  requests: [`QmImage-${registry} ${trustedZone}`],
  sealed: [`${pox} ${certificateOf(trustedZone, registry)}`]
});

// The steps of a run a setNetwork() is called at: its first chain read, its
// approval, its request, its order approval and its last chain read.
const STEPS = [
  ['call', 'balanceOf'],
  ['send', 'approve'],
  ['send', '_addDORequest'],
  ['send', '_approveOrder'],
  ['call', '_getResultFromOrder']
];

const DEFERRED = (network, type) =>
  `setNetwork(${network}, ${type}) takes effect once the operations in flight on this runner have ended.`;

test('setNetwork() with no operation queued or in flight applies in the call', async () => {
  const { runner } = runnerOn(AMOY, AMOY_TOKEN);
  const named = runner.setNetwork('POLYGON', 'AMOY_POX10');
  assert.equal(runner.networkConfig, ECPox10TestnetConfig.POLYGON);
  assert.equal(runner.protocolContract.getContract().target, ECAddress.POLYGON.AMOY_POX10_PROTOCOL_ADDRESS);
  await named;
  // After a run has ended as well.
  await task(runner);
  const back = runner.setNetwork('POLYGON', 'TESTNET');
  assert.equal(runner.networkConfig, ECNetworkConfig[AMOY_TOKEN]);
  assert.equal(runner.protocolContract.getContract().target, ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS);
  await back;
  assert.deepEqual(runner.events.filter((message) => message.startsWith('setNetwork(')), []);
});

test('Polygon Amoy: setNetwork(POLYGON, AMOY_POX10) called at any step of a run on the PoX 2.0 network applies after it; the run is on PoX 2.0 to its last step and the next one on PoX 1.0', { timeout: 60000 }, async () => {
  for (const [kind, name] of STEPS) {
    const { chain, runner } = runnerOn(AMOY, AMOY_TOKEN);
    const called = {};
    chain.during(kind, name, () => {
      called.change = runner.setNetwork('POLYGON', 'AMOY_POX10');
      called.network = runner.networkConfig;
      called.pox = runner.protocolContract.getContract().target;
    });
    await task(runner);
    // The name did not apply in the call.
    assert.equal(called.network, ECNetworkConfig[AMOY_TOKEN], name);
    assert.equal(called.pox, ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS, name);
    await called.change;
    assert.equal(runner.networkConfig, ECPox10TestnetConfig.POLYGON, name);
    assert.ok(runner.events.includes(DEFERRED('POLYGON', 'AMOY_POX10')), name);
    await task(runner);
    const [first, second] = runsOf(chain.log);
    assert.deepEqual(traffic(first), onNetwork(AMOY_POX20), name);
    assert.deepEqual(traffic(second), onNetwork(AMOY_POX10), name);
  }
});

test('Polygon Amoy, the reverse: setNetwork(POLYGON, TESTNET) called at any step of a run on the PoX 1.0 network applies after it', { timeout: 60000 }, async () => {
  for (const [kind, name] of STEPS) {
    const { chain, runner } = runnerOn(AMOY, AMOY_TOKEN);
    await runner.setNetwork('POLYGON', 'AMOY_POX10');
    const called = {};
    chain.during(kind, name, () => {
      called.change = runner.setNetwork('POLYGON', 'TESTNET');
      called.network = runner.networkConfig;
    });
    await task(runner);
    assert.equal(called.network, ECPox10TestnetConfig.POLYGON, name);
    await called.change;
    assert.equal(runner.networkConfig, ECNetworkConfig[AMOY_TOKEN], name);
    await task(runner);
    const [first, second] = runsOf(chain.log);
    assert.deepEqual(traffic(first), onNetwork(AMOY_POX10), name);
    assert.deepEqual(traffic(second), onNetwork(AMOY_POX20), name);
  }
});

test('run(), setNetwork() and run() called one after the other, none awaited: each run is on the network named before its call', { timeout: 60000 }, async () => {
  const { chain, runner } = runnerOn(AMOY, AMOY_TOKEN);
  const first = task(runner);
  const toPox10 = runner.setNetwork('POLYGON', 'AMOY_POX10');
  const second = task(runner);
  const toPox20 = runner.setNetwork('POLYGON', 'TESTNET');
  const third = task(runner);
  // Nothing has applied in the calls.
  assert.equal(runner.networkConfig, ECNetworkConfig[AMOY_TOKEN]);
  await Promise.all([first, toPox10, second, toPox20, third]);
  assert.deepEqual(runsOf(chain.log).map(traffic), [AMOY_POX20, AMOY_POX10, AMOY_POX20].map(onNetwork));
  assert.equal(runner.networkConfig, ECNetworkConfig[AMOY_TOKEN]);
});

test('a name the runner refuses, called during a run, is refused when its turn comes: the run in flight and the next one are on the runner\'s network', { timeout: 60000 }, async () => {
  const { chain, runner } = runnerOn(AMOY, AMOY_TOKEN);
  const called = {};
  chain.during('send', 'approve', () => {
    called.mainnet = assert.rejects(runner.setNetwork('POLYGON', 'MAINNET'), {
      message: "setNetwork: POLYGON MAINNET is not on the chain of this runner's address (POLYGON TESTNET)"
    });
    called.unknown = assert.rejects(runner.setNetwork('POLYGON', 'TESTNET_POX10'), {
      message: 'setNetwork: POLYGON TESTNET_POX10 is not a network this runner knows'
    });
  });
  await task(runner);
  await called.mainnet;
  await called.unknown;
  await task(runner);
  assert.deepEqual(runsOf(chain.log).map(traffic), [AMOY_POX20, AMOY_POX20].map(onNetwork));
});

test('the bloxberg testnet: its runner takes no PoX 1.0 name, during a run as outside one; its -unsafe name, called during a run, applies after it', { timeout: 60000 }, async () => {
  const { chain, runner } = runnerOn(BLOXBERG, BLOXBERG_TOKEN);
  const called = {};
  chain.during('call', 'balanceOf', () => {
    called.pox10 = assert.rejects(runner.setNetwork('BLOXBERG', 'TESTNET_POX10'), {
      message: `setNetwork: BLOXBERG TESTNET_POX10 is paid with the token ${BLOXBERG_POX10_TOKEN}: construct the runner with that address`
    });
    called.unsafe = runner.setNetwork('BLOXBERG', 'TESTNET_UNSAFE');
  });
  await task(runner);
  await called.pox10;
  await called.unsafe;
  await task(runner);
  const unsafe = { ...BLOXBERG_POX20, trustedZone: ECRunner.BLOXBERG.PYNITHY_RUNNER_TESTNET_UNSAFE };
  assert.deepEqual(runsOf(chain.log).map(traffic), [BLOXBERG_POX20, unsafe].map(onNetwork));
});

test('the bloxberg PoX 1.0 network: its runner is on it for every run, whatever is named during one', { timeout: 60000 }, async () => {
  for (const [kind, name] of STEPS.filter(([, step]) => step !== 'approve')) {
    const { chain, runner } = runnerOn(BLOXBERG, BLOXBERG_POX10_TOKEN);
    const called = {};
    chain.during(kind, name, () => {
      called.pox20 = assert.rejects(runner.setNetwork('BLOXBERG', 'TESTNET'), {
        message: "setNetwork: BLOXBERG TESTNET is not the network of this runner's address (BLOXBERG TESTNET_POX10)"
      });
      called.own = runner.setNetwork('BLOXBERG', 'TESTNET_POX10');
    });
    await task(runner);
    await called.pox20;
    await called.own;
    assert.equal(runner.networkConfig, ECPox10TestnetConfig.BLOXBERG, name);
    await task(runner);
    assert.deepEqual(runsOf(chain.log).map(traffic), [BLOXBERG_POX10, BLOXBERG_POX10].map(onNetwork), name);
  }
});

// What a session's calls in `entries` touched.
const sessionTraffic = (entries) => {
  const { sent, estimated, read, sealed } = traffic(entries);
  return { sent, estimated, read, sealed };
};

test('a session keeps the network it was opened on: its rows, its reads, its seal and its result read are that network\'s while the runner is on the other one, and runs there', { timeout: 60000 }, async () => {
  const { chain, runner } = runnerOn(AMOY, AMOY_TOKEN);
  const onPox20 = await runner.runSession(RESOURCES, SECURELOCK, 'code');
  await runner.setNetwork('POLYGON', 'AMOY_POX10');
  await task(runner);
  const onPox10 = await runner.runSession(RESOURCES, SECURELOCK, 'code');
  // The runner is on the PoX 1.0 network and holds its trustedzone's certificate.
  assert.equal(runner.networkConfig, ECPox10TestnetConfig.POLYGON);
  assert.equal(runner.enclavePublicKey, certificateOf(AMOY_POX10.trustedZone, 'registry10'));
  assert.equal(onPox20.network, ECNetworkConfig[AMOY_TOKEN]);
  assert.equal(onPox10.network, ECPox10TestnetConfig.POLYGON);

  await settle();
  let mark = chain.log.length;
  assert.equal(await onPox20.sendInput('an input for the PoX 2.0 session'), 0);
  assert.deepEqual(await onPox20.pollOutputs(), []);
  assert.equal(await onPox20.isRunning(), true);
  assert.deepEqual(sessionTraffic(chain.log.slice(mark)), {
    sent: ['pox20._addMetadataToRequest'],
    estimated: ['pox20._addMetadataToRequest'],
    read: ['pox20'],
    sealed: [`pox20 ${certificateOf(AMOY_POX20.trustedZone, 'registry20')}`]
  });
  // The close row goes to the session's PoX, and the result is read from it,
  // decoded with its ABI and held to be addressed to it: the read ends at the
  // check of the result's signer, which the stand-in chain's key does not pass.
  mark = chain.log.length;
  assert.deepEqual(await onPox20.close(true, 0), {
    success: false,
    operatorFault: true,
    message: 'Integrity check failed, signer wallet address is wrong.'
  });
  assert.deepEqual(sessionTraffic(chain.log.slice(mark)), {
    sent: ['pox20._addMetadataToRequest'],
    estimated: ['pox20._addMetadataToRequest'],
    read: ['pox20'],
    sealed: []
  });
  assert.deepEqual(chain.at(ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS).requests[onPox20.doReq].rows.map(([key, value]) => [key, value.split(':').slice(0, 3).join(':')]), [
    ['etny-si', `v1:0:${onPox20.orderId}`],
    ['etny-si', `v1:close:${onPox20.orderId}`]
  ]);

  // The reverse: the runner back on the PoX 2.0 network, with a run there,
  // and the session opened on PoX 1.0.
  await runner.setNetwork('POLYGON', 'TESTNET');
  await task(runner);
  assert.equal(runner.enclavePublicKey, certificateOf(AMOY_POX20.trustedZone, 'registry20'));
  await settle();
  mark = chain.log.length;
  assert.equal(await onPox10.sendInput('an input for the PoX 1.0 session'), 0);
  assert.deepEqual(await onPox10.close(true, 0), {
    success: false,
    operatorFault: true,
    message: 'Integrity check failed, signer wallet address is wrong.'
  });
  assert.deepEqual(sessionTraffic(chain.log.slice(mark)), {
    sent: ['pox10._addMetadataToRequest', 'pox10._addMetadataToRequest'],
    estimated: ['pox10._addMetadataToRequest', 'pox10._addMetadataToRequest'],
    read: ['pox10'],
    sealed: [`pox10 ${certificateOf(AMOY_POX10.trustedZone, 'registry10')}`]
  });
});

test('attachSession() takes its turn: called during a run, after a setNetwork(), it attaches on the named network once the run has ended', { timeout: 60000 }, async () => {
  const { chain, runner } = runnerOn(AMOY, AMOY_TOKEN);
  await runner.setNetwork('POLYGON', 'AMOY_POX10');
  const opened = await runner.runSession(RESOURCES, SECURELOCK, 'code');
  await runner.setNetwork('POLYGON', 'TESTNET');
  await settle();
  const mark = chain.log.length;
  const run = task(runner);
  const change = runner.setNetwork('POLYGON', 'AMOY_POX10');
  const attach = runner.attachSession(opened.orderId, SECURELOCK);
  const [, , session] = await Promise.all([run, change, attach]);
  const since = chain.log.slice(mark);
  const end = since.findIndex((entry) => entry.kind === 'end');
  // The run in flight is on PoX 2.0 and holds none of the attach's reads.
  assert.deepEqual(traffic(since.slice(0, end)), onNetwork(AMOY_POX20));
  const attached = traffic(since.slice(end + 1));
  assert.deepEqual(attached.read, ['pox10', 'registry10']);
  assert.deepEqual(attached.registry, [
    `registry10.getLatestTrustedZoneImageCertPublicKey(${AMOY_POX10.trustedZone})`,
    `registry10.getLatestImageVersionPublicKey(${SECURELOCK})`
  ]);
  assert.deepEqual(attached.sent, []);
  assert.equal(session.orderId, opened.orderId);
  assert.equal(session.network, ECPox10TestnetConfig.POLYGON);
  assert.equal(session.certificate, certificateOf(AMOY_POX10.trustedZone, 'registry10'));
});

test('the task of esrRead() takes its turn: called during a run, it is submitted once the run has ended', { timeout: 60000 }, async () => {
  const { chain, runner } = runnerOn(AMOY, AMOY_TOKEN);
  const end = runner.getOrderResult;
  runner.getOrderResult = async () => {
    runner.structuredResult = { esr: { wallet: WALLET, entries: [{ key: 'counter', state: '1', version: 1, cid: 'QmState' }] } };
    await end();
  };
  const run = task(runner);
  const read = runner.esrRead({ key: 'counter' });
  await run;
  assert.deepEqual(await read, { state: '1', version: 1, cid: 'QmState', wallet: WALLET, fromCache: false, checkedOnChain: false });
  const [first, second] = runsOf(chain.log);
  assert.deepEqual(traffic(first), onNetwork(AMOY_POX20));
  assert.deepEqual(traffic(second).sent, ['pox20._addDORequest', 'pox20._approveOrder']);
  assert.deepEqual(traffic(second).requests, [`QmImage-registry20 ${AMOY_POX20.trustedZone}`]);
});
