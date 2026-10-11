import { test } from 'node:test';
import assert from 'node:assert/strict';
import EthernityCloudRunner from '../runner.js';
import { ECAddress, ECNetworkConfig, ECEcldTestnetConfig } from '../enums.js';
import { isInitialized } from '../ipfs.js';

// A provider that answers the chain id and nothing else: the runner reads it
// to resolve the network and makes no other call before the storage is chosen.
const providerOn = (chainId) => ({ getNetwork: async () => ({ chainId: BigInt(chainId) }) });

// An assert.throws validator matching the error's message, which the
// RegExp form of assert.throws does not: that one matches String(error),
// which begins with the error's name.
const messageMatching = (pattern) => (e) => {
  assert.match(e.message, pattern);
  return true;
};

test('the Bloxberg testnet is the only network routed to the intake in this release', () => {
  const routed = Object.values(ECNetworkConfig).filter((cfg) => cfg.agentNetwork).map((cfg) => cfg.agentNetwork);
  assert.deepEqual(routed, ['bloxberg_testnet']);
  assert.ok(Object.values(ECEcldTestnetConfig).every((cfg) => cfg.agentNetwork === undefined));
});

// The tests run in this order: the storage module is unconfigured until the
// one that configures the intake.
test('a network without an intake route refuses to run with no storage configured', async () => {
  const runner = new EthernityCloudRunner(ECAddress.IOTEX.TESTNET_ADDRESS, { provider: providerOn(4690) }, 4690);
  await runner.resolveNetworkContext();
  assert.equal(runner.networkConfig.agentNetwork, undefined);
  assert.equal(isInitialized(), false);
  assert.throws(
    () => runner.initializeDefaultStorage(),
    (e) => {
      assert.match(e.message, /^IOTEX TESTNET has no payload intake route/);
      assert.match(e.message, /initializeStorage\('http:\/\/127\.0\.0\.1:5001'\)/);
      assert.match(e.message, /initializeStorage\('https:\/\/ipfs\.ethernity\.cloud', undefined, undefined, token\)/);
      return true;
    }
  );
  assert.equal(isInitialized(), false);
});

test('Polygon Amoy has no intake route: a run with no storage configured is refused before any transaction', async () => {
  const runner = new EthernityCloudRunner(ECAddress.POLYGON.TESTNET_ADDRESS, { provider: providerOn(80002) });
  await runner.resolveNetworkContext();
  assert.equal(runner.networkConfig.networkName, 'amoy');
  assert.equal(runner.networkConfig.agentNetwork, undefined);
  assert.throws(() => runner.initializeDefaultStorage(), messageMatching(/^POLYGON TESTNET has no payload intake route/));
  assert.throws(
    () => runner.initializePublicIntake(),
    messageMatching(/^initializePublicIntake: this network has no payload intake route/)
  );
  assert.equal(isInitialized(), false);
});

test('Bloxberg mainnet and Polygon mainnet have no intake route either', async () => {
  for (const [address, chainId, label] of [
    [ECAddress.BLOXBERG.MAINNET_ADDRESS, 8995, 'BLOXBERG MAINNET'],
    [ECAddress.POLYGON.MAINNET_ADDRESS, 137, 'POLYGON MAINNET']
  ]) {
    const runner = new EthernityCloudRunner(address, { provider: providerOn(chainId) });
    await runner.resolveNetworkContext();
    assert.equal(runner.networkConfig.isMainnet, true);
    assert.equal(runner.networkConfig.agentNetwork, undefined);
    assert.throws(
      () => runner.initializeDefaultStorage(),
      messageMatching(new RegExp(`^${label} has no payload intake route`))
    );
  }
  assert.equal(isInitialized(), false);
});

test('a network with an agent network name gets the intake by default', async () => {
  const runner = new EthernityCloudRunner(ECAddress.BLOXBERG.TESTNET_ADDRESS, { provider: providerOn(8995) });
  await runner.resolveNetworkContext();
  assert.equal(runner.networkConfig.agentNetwork, 'bloxberg_testnet');
  runner.initializeDefaultStorage();
  assert.equal(isInitialized(), true);
});

test('a storage configured before run() takes precedence on every network', async () => {
  const runner = new EthernityCloudRunner(ECAddress.IOTEX.TESTNET_ADDRESS, { provider: providerOn(4690) }, 4690);
  await runner.resolveNetworkContext();
  assert.doesNotThrow(() => runner.initializeDefaultStorage());
});
