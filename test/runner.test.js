import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import EthernityCloudRunner from '../runner.js';
import {
  ECAddress, ECNetworkConfig, ECEcldTestnetConfig, ECPox10TestnetConfig, ECLD_SHARED_TESTNET_TOKEN, ECError, networkTypeOf, resolveNetworkConfig
} from '../enums.js';
import { initialize, intakeNetwork, isInitialized } from '../ipfs.js';
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

test('the Bloxberg testnet, Polygon Amoy, LitVM LiteForge and Ethereum Sepolia are the networks routed to the intake in this release', () => {
  const routed = Object.values(ECNetworkConfig).filter((cfg) => cfg.agentNetwork).map((cfg) => cfg.agentNetwork);
  assert.deepEqual(routed, ['bloxberg_testnet', 'polygon_amoy']);
  const ecld = Object.entries(ECEcldTestnetConfig).filter(([, cfg]) => cfg.agentNetwork).map(([chainId, cfg]) => [chainId, cfg.agentNetwork]);
  assert.deepEqual(ecld, [['4441', 'litvm_liteforge'], ['11155111', 'ethereum_sepolia']]);
});

// The README's name of each network routed to the intake, by agent network name.
const README_ROUTED = {
  bloxberg_testnet: 'the Bloxberg testnet',
  polygon_amoy: 'Polygon Amoy',
  litvm_liteforge: 'LitVM LiteForge',
  ethereum_sepolia: 'Ethereum Sepolia'
};

test('the README\'s storage section names the networks the runner routes to the intake, and the ones a run is refused on without a storage, as the descriptors do', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const section = readme.slice(readme.indexOf('### Storage and the result read'));
  const published = [...Object.values(ECNetworkConfig), ...Object.values(ECEcldTestnetConfig)];
  const routed = published.filter((cfg) => cfg.agentNetwork).map((cfg) => README_ROUTED[cfg.agentNetwork]);
  const unrouted = [...published, ...Object.values(ECPox10TestnetConfig)].filter((cfg) => !cfg.agentNetwork)
    .map((cfg) => `${cfg.networkKey} ${networkTypeOf(cfg)}`);
  assert.deepEqual(unrouted, ['BLOXBERG MAINNET', 'POLYGON MAINNET', 'IOTEX TESTNET', 'BLOXBERG TESTNET_POX10', 'POLYGON AMOY_POX10']);
  const sentence = `the runner routes to it ${routed.slice(0, -1).join(', ')} and ${routed.at(-1)}, each with its -unsafe twin: ` +
    'on every other network (Bloxberg mainnet, Polygon mainnet, IoTeX and the two PoX 1.0 testnet networks) `run()` fails before any transaction is sent';
  assert.ok(section.includes(sentence), sentence);
});

test('npm test is node\'s test runner with no path: every .js file under a directory named test is a test file, and no other file has a test file\'s name', () => {
  const root = new URL('../', import.meta.url);
  assert.equal(JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).scripts.test, 'node --test');
  // The package's .js, .cjs and .mjs files, by path from its root; the
  // directories node's runner skips or that hold no source are passed over.
  const scripts = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : scripts(`${dir}${entry.name}/`);
    return /\.(c|m)?js$/.test(entry.name) ? [`${dir}${entry.name}`] : [];
  });
  const all = scripts('');
  // With no path the runner takes every such file under a directory named
  // test, and elsewhere the files named test, test-*, *.test, *-test, *_test.
  const taken = all.filter((file) => file.split('/').slice(0, -1).includes('test') ||
    /(^|\/)(test|test-[^/]+|[^/]+[._-]test)\.(c|m)?js$/.test(file));
  assert.ok(taken.length > 0);
  assert.deepEqual(taken.filter((file) => !/^test\/[^/]+\.test\.js$/.test(file)), []);
  assert.ok(all.includes('testing/standInChain.js'));
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

test('Polygon Amoy is routed to the intake under the agent name polygon_amoy', async () => {
  const runner = new EthernityCloudRunner(ECAddress.POLYGON.TESTNET_ADDRESS, { provider: providerOn(80002) });
  await runner.resolveNetworkContext();
  assert.equal(runner.networkConfig.networkName, 'amoy');
  assert.equal(runner.networkConfig.agentNetwork, 'polygon_amoy');
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
  for (const [address, chainId, agentNetwork] of [
    [ECAddress.BLOXBERG.TESTNET_ADDRESS, 8995, 'bloxberg_testnet'],
    [ECAddress.POLYGON.TESTNET_ADDRESS, 80002, 'polygon_amoy']
  ]) {
    const runner = new EthernityCloudRunner(address, { provider: providerOn(chainId) });
    await runner.resolveNetworkContext();
    assert.equal(runner.networkConfig.agentNetwork, agentNetwork);
    runner.initializeDefaultStorage();
    assert.equal(isInitialized(), true);
  }
});

test('an IPFS API of the application\'s own, configured before run(), takes precedence on every network; the intake serves no network without a route', async () => {
  const runner = new EthernityCloudRunner(ECAddress.IOTEX.TESTNET_ADDRESS, { provider: providerOn(4690) }, 4690);
  await runner.resolveNetworkContext();
  // The storage in effect is the intake the test above set: IoTeX has no
  // route under it.
  assert.equal(intakeNetwork(), 'bloxberg_testnet');
  assert.throws(
    () => runner.initializeDefaultStorage(),
    messageMatching(/^IOTEX TESTNET has no payload intake route, and the storage in effect is the payload intake: configure the storage before submitting a task/)
  );
  initialize('http://127.0.0.1:5001');
  assert.equal(intakeNetwork(), null);
  assert.doesNotThrow(() => runner.initializeDefaultStorage());
  // A network with a route takes the configured API too.
  const amoy = new EthernityCloudRunner(ECAddress.POLYGON.TESTNET_ADDRESS, { provider: providerOn(80002) });
  await amoy.resolveNetworkContext();
  assert.doesNotThrow(() => amoy.initializeDefaultStorage());
  assert.equal(intakeNetwork(), null);
});

test("Sepolia's own token selects its RPC on the raw-key path; the shared token falls back to the Bloxberg testnet's", () => {
  const key = ethers.Wallet.createRandom().privateKey;
  const sepolia = resolveWalletContext(ECAddress.SEPOLIA.TESTNET_ADDRESS, { privateKey: key });
  assert.equal(sepolia.provider._getConnection().url, 'https://ethereum-sepolia-rpc.publicnode.com');
  sepolia.provider.destroy();
  const shared = resolveWalletContext(ECLD_SHARED_TESTNET_TOKEN, { privateKey: key });
  assert.equal(shared.provider._getConnection().url, 'https://bloxberg.ethernity.cloud');
  shared.provider.destroy();
  // The LiteForge testnet is hosted by Zeeve since 2026-11-12.
  const litvm = resolveWalletContext(ECLD_SHARED_TESTNET_TOKEN, { privateKey: key, rpcUrl: 'https://rpc.testnet.liteforge.zeeve.net/' });
  assert.equal(litvm.provider._getConnection().url, 'https://rpc.testnet.liteforge.zeeve.net/');
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
      getProvider: () => ({ send: async () => ({ status: '0x1', blockNumber: '0x1', logs: [] }) }),
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
