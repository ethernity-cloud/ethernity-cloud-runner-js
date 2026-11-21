// The storage guard of a run (runner.storageRefusal). The storage is the
// process's (ipfs.js), whichever runner set it, and it is judged against the
// network of each run and of each artefact: a network without a payload
// intake route (a descriptor without agentNetwork: the two PoX 1.0 testnet
// networks, Bloxberg mainnet, Polygon mainnet, IoTeX) is served by an IPFS
// API of the application's own and by nothing else. With no storage set, and
// with the intake another network's run or the application set, a run on
// such a network is refused before any request reaches the chain, and so are
// runSession(), attachSession(), the task of esrRead() and the seal of an
// artefact. A network with a route takes the storage in effect.
//
// No chain: the provider answers the chain id and records every other
// request, which fails. The tests share the process's storage and run in the
// order they are written in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EthernityCloudRunner from '../runner.js';
import { ECAddress, ECNetworkConfig, ECPox10TestnetConfig } from '../enums.js';
import { initialize, intakeNetwork, isInitialized, PUBLIC_INTAKE } from '../ipfs.js';

const WALLET = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';
const SECURELOCK = 'my-securelock';
const RESOURCES = { taskPrice: 3, validators: 1, duration: 1 };
const AMOY_TOKEN = ECAddress.POLYGON.TESTNET_ADDRESS;

// A runner constructed with `address` on `chainId`, its network context
// resolved, named onto `name` when given. runner.reached lists the requests
// that reached the chain: every eth_call, gas estimate, raw request, log
// read and transaction, each of which fails.
const runnerOn = async (address, chainId, name = null) => {
  const reached = [];
  const failing = (request) => async () => {
    reached.push(request);
    throw new Error(`${request} reached the chain`);
  };
  const provider = {
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    call: failing('eth_call'),
    estimateGas: failing('eth_estimateGas'),
    send: failing('a raw request'),
    getBlockNumber: failing('eth_blockNumber'),
    getLogs: failing('eth_getLogs')
  };
  const signer = { provider, getAddress: async () => WALLET, sendTransaction: failing('a transaction') };
  const runner = new EthernityCloudRunner(address, { provider, signer, encryptionPublicKey: 'ab'.repeat(32) }, chainId);
  runner.reached = reached;
  await runner.resolveNetworkContext();
  if (name) await runner.setNetwork(...name);
  return runner;
};

// The networks without a payload intake route, as the refusal names them.
const UNROUTED = [
  ['BLOXBERG TESTNET_POX10', () => runnerOn(ECAddress.BLOXBERG.TESTNET_POX10_ADDRESS, 8995)],
  ['POLYGON AMOY_POX10', () => runnerOn(AMOY_TOKEN, 80002, ['POLYGON', 'AMOY_POX10'])],
  ['BLOXBERG MAINNET', () => runnerOn(ECAddress.BLOXBERG.MAINNET_ADDRESS, 8995)],
  ['POLYGON MAINNET', () => runnerOn(ECAddress.POLYGON.MAINNET_ADDRESS, 137)],
  ['IOTEX TESTNET', () => runnerOn(ECAddress.IOTEX.TESTNET_ADDRESS, 4690)]
];

// The refusal of `network`, with the intake of `intake` in effect when given.
const refusal = (network, intake = null) =>
  `${network} has no payload intake route${intake ? `, and the storage in effect is the intake route of ${intake}` : ''}: ` +
  "configure the storage before submitting a task, with initializeStorage('http://127.0.0.1:5001') for your own Kubo RPC API, or " +
  `initializeStorage('${PUBLIC_INTAKE}', undefined, undefined, token) for the public API with your writer token.`;

const task = (runner) => runner.run(RESOURCES, SECURELOCK, 'code', '', null, { maxRetries: 0 });

test('with no storage set, a run on a network without a route is refused before any request reaches the chain, and sets no storage', async () => {
  for (const [network, build] of UNROUTED) {
    const runner = await build();
    await assert.rejects(task(runner), { message: refusal(network) }, network);
    assert.deepEqual(runner.reached, [], network);
    assert.equal(isInitialized(), false, network);
  }
});

test('the default storage of a network with a route is the intake under that route', async () => {
  const amoy = await runnerOn(AMOY_TOKEN, 80002);
  assert.equal(amoy.storageRefusal(), null);
  amoy.initializeDefaultStorage();
  assert.equal(intakeNetwork(), 'polygon_amoy');
});

test('with the intake of Polygon Amoy in effect, the runner that set it, named onto its PoX 1.0 network, is refused before any request reaches the chain', async () => {
  const runner = await runnerOn(AMOY_TOKEN, 80002);
  runner.initializeDefaultStorage();
  await runner.setNetwork('POLYGON', 'AMOY_POX10');
  await assert.rejects(task(runner), { message: refusal('POLYGON AMOY_POX10', 'polygon_amoy') });
  assert.deepEqual(runner.reached, []);
  assert.equal(intakeNetwork(), 'polygon_amoy');
  // Named back onto the PoX 2.0 network, the runner takes the intake.
  await runner.setNetwork('POLYGON', 'TESTNET');
  assert.equal(runner.storageRefusal(), null);
});

test('with the intake of Polygon Amoy in effect, a run of another runner on a network without a route is refused before any request reaches the chain', async () => {
  for (const [network, build] of UNROUTED) {
    const runner = await build();
    await assert.rejects(task(runner), { message: refusal(network, 'polygon_amoy') }, network);
    assert.deepEqual(runner.reached, [], network);
  }
  assert.equal(intakeNetwork(), 'polygon_amoy');
});

test('runSession(), attachSession() and the task of esrRead() are refused as run() is', async () => {
  const runner = await runnerOn(AMOY_TOKEN, 80002, ['POLYGON', 'AMOY_POX10']);
  const message = refusal('POLYGON AMOY_POX10', 'polygon_amoy');
  await assert.rejects(runner.runSession(RESOURCES, SECURELOCK, 'code'), { message });
  await assert.rejects(runner.attachSession(1), { message });
  await assert.rejects(runner.esrRead({ key: 'counter' }), { message });
  assert.deepEqual(runner.reached, []);
});

test('an artefact is judged for the network it is for, before it is sealed: a session\'s network when it is not the runner\'s', async () => {
  const pox20 = ECNetworkConfig[AMOY_TOKEN];
  const pox10 = ECPox10TestnetConfig.POLYGON;
  // A runner on the PoX 2.0 network sealing for a session of the PoX 1.0 one.
  const onPox20 = await runnerOn(AMOY_TOKEN, 80002);
  assert.equal(onPox20.storageRefusal(), null);
  assert.equal(onPox20.storageRefusal(pox10), refusal('POLYGON AMOY_POX10', 'polygon_amoy'));
  await assert.rejects(onPox20._sealArtefact('an input', pox10, 'a certificate'), { message: refusal('POLYGON AMOY_POX10', 'polygon_amoy') });
  // A runner on the PoX 1.0 network: its own artefacts are refused, those of
  // a session of the PoX 2.0 network are not.
  const onPox10 = await runnerOn(AMOY_TOKEN, 80002, ['POLYGON', 'AMOY_POX10']);
  await assert.rejects(onPox10._sealArtefact('a challenge'), { message: refusal('POLYGON AMOY_POX10', 'polygon_amoy') });
  assert.equal(onPox10.storageRefusal(pox20), null);
});

test('a network with a route takes the intake in effect, whichever network it was set for', async () => {
  const bloxberg = await runnerOn(ECAddress.BLOXBERG.TESTNET_ADDRESS, 8995);
  assert.equal(bloxberg.storageRefusal(), null);
  bloxberg.initializeDefaultStorage();
  assert.equal(intakeNetwork(), 'polygon_amoy');
});

test('an IPFS API of the application\'s own serves every network', async () => {
  initialize('http://127.0.0.1:5001');
  assert.equal(intakeNetwork(), null);
  for (const [network, build] of UNROUTED) {
    const runner = await build();
    assert.equal(runner.storageRefusal(), null, network);
    assert.doesNotThrow(() => runner.initializeDefaultStorage(), network);
  }
  const amoy = await runnerOn(AMOY_TOKEN, 80002);
  assert.doesNotThrow(() => amoy.initializeDefaultStorage());
  assert.equal(intakeNetwork(), null);
});

test('an intake the application sets for a network with a route serves no network without one, and no intake is set for a network without a route', async () => {
  const amoy = await runnerOn(AMOY_TOKEN, 80002);
  amoy.initializePublicIntake();
  assert.equal(intakeNetwork(), 'polygon_amoy');
  for (const [network, build] of UNROUTED) {
    const runner = await build();
    assert.equal(runner.storageRefusal(), refusal(network, 'polygon_amoy'), network);
    assert.throws(() => runner.initializeDefaultStorage(), { message: refusal(network, 'polygon_amoy') }, network);
    assert.throws(() => runner.initializePublicIntake(), { message: 'initializePublicIntake: this network has no payload intake route' }, network);
  }
  assert.equal(intakeNetwork(), 'polygon_amoy');
});
