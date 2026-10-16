import { test } from 'node:test';
import assert from 'node:assert/strict';
import EthernityCloudRunner from '../runner.js';
import { ECAddress, ECNetworkConfig, ECEcldTestnetConfig, ECLD_SHARED_TESTNET_TOKEN, ECError, resolveNetworkConfig } from '../enums.js';
import { isInitialized } from '../ipfs.js';
import { resolveWalletContext } from '../walletContext.js';
import { ethers } from 'ethers';

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

test('the Bloxberg testnet, LitVM LiteForge and Ethereum Sepolia are the networks routed to the intake in this release', () => {
  const routed = Object.values(ECNetworkConfig).filter((cfg) => cfg.agentNetwork).map((cfg) => cfg.agentNetwork);
  assert.deepEqual(routed, ['bloxberg_testnet']);
  const ecld = Object.entries(ECEcldTestnetConfig).filter(([, cfg]) => cfg.agentNetwork).map(([chainId, cfg]) => [chainId, cfg.agentNetwork]);
  assert.deepEqual(ecld, [['4441', 'litvm_liteforge'], ['11155111', 'ethereum_sepolia']]);
});

test("Sepolia's own token names its descriptor without a chainId; the shared token still needs one", () => {
  assert.equal(resolveNetworkConfig(ECAddress.SEPOLIA.TESTNET_ADDRESS), ECEcldTestnetConfig[11155111]);
  assert.equal(resolveNetworkConfig(ECAddress.SEPOLIA.TESTNET_ADDRESS, 11155111), ECEcldTestnetConfig[11155111]);
  assert.notEqual(ECAddress.SEPOLIA.TESTNET_ADDRESS, ECLD_SHARED_TESTNET_TOKEN);
  assert.equal(resolveNetworkConfig(ECLD_SHARED_TESTNET_TOKEN).protocolAddress, undefined);
  assert.equal(resolveNetworkConfig(ECLD_SHARED_TESTNET_TOKEN, 4441), ECEcldTestnetConfig[4441]);
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

test("Sepolia's own token selects its RPC on the raw-key path; the shared token falls back to the Bloxberg testnet's", () => {
  const key = ethers.Wallet.createRandom().privateKey;
  const sepolia = resolveWalletContext(ECAddress.SEPOLIA.TESTNET_ADDRESS, { privateKey: key });
  assert.equal(sepolia.provider._getConnection().url, 'https://ethereum-sepolia-rpc.publicnode.com');
  sepolia.provider.destroy();
  const shared = resolveWalletContext(ECLD_SHARED_TESTNET_TOKEN, { privateKey: key });
  assert.equal(shared.provider._getConnection().url, 'https://bloxberg.ethernity.cloud');
  shared.provider.destroy();
  const litvm = resolveWalletContext(ECLD_SHARED_TESTNET_TOKEN, { privateKey: key, rpcUrl: 'https://liteforge.rpc.caldera.xyz/infra-partner-http' });
  assert.equal(litvm.provider._getConnection().url, 'https://liteforge.rpc.caldera.xyz/infra-partner-http');
  litvm.provider.destroy();
});

// cancelUnclaimedRequest, on a stand-in for the runner: the protocol contract
// and the order scan are replaced, nothing touches a chain.
const unclaimed = ({ cancel, orders = [] }) => {
  const events = [];
  const self = {
    ordersOffset: 0,
    dispatchECEvent: (m) => events.push(m),
    protocolContract: {
      cancelDORequest: cancel,
      getContract: () => ({
        _getOrdersCount: async () => BigInt(orders.length),
        _getOrder: async (i) => ({ doRequest: BigInt(orders[i]) })
      })
    }
  };
  self.orderForRequest = EthernityCloudRunner.prototype.orderForRequest.bind(self);
  return { self, events };
};

test('a request no node took is cancelled and the task fails with NO_NODE', async () => {
  let cancelled = null;
  const { self } = unclaimed({
    cancel: async (id) => { cancelled = id; return { hash: '0xc', wait: async () => ({ status: 1 }) }; },
    orders: [3, 4]
  });
  await assert.rejects(EthernityCloudRunner.prototype.cancelUnclaimedRequest.call(self, 9, 600),
    (e) => e.code === ECError.NO_NODE && /cancelled and its escrow returned/.test(e.message));
  assert.equal(cancelled, 9);
});

test('a request a node booked before the cancel goes on with that order', async () => {
  const { self } = unclaimed({
    cancel: async () => { const e = new Error('execution reverted: status must be available'); e.code = 'CALL_EXCEPTION'; throw e; },
    orders: [3, 9, 4]
  });
  assert.equal(await EthernityCloudRunner.prototype.cancelUnclaimedRequest.call(self, 9, 600), 1);
});

test('a cancel that fails with no order on the request fails the task with the reason', async () => {
  const { self } = unclaimed({
    cancel: async () => { throw new Error('nonce too low'); },
    orders: [3]
  });
  await assert.rejects(EthernityCloudRunner.prototype.cancelUnclaimedRequest.call(self, 9, 600),
    /could not be cancelled: nonce too low/);
});
