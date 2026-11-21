// The PoX 1.0 testnet networks: copies of the mainnets' PoX 1.0 contracts on
// the bloxberg testnet and on Polygon Amoy, each used as the mainnet it
// copies. The bloxberg copy has a token of its own, which names it; its type
// is TESTNET_POX10. The Amoy copy is paid in the test ECLD of the Amoy PoX
// 2.0 network on the same chain: the token names the PoX 2.0 network, and
// setNetwork('POLYGON', 'AMOY_POX10') names the PoX 1.0 network, which the
// network resolution of a run keeps. Neither network's name, token or
// trustedzone selects the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EthernityCloudRunner from '../runner.js';
import {
  ECAddress,
  ECNetworkConfig,
  ECEcldTestnetConfig,
  ECPox10TestnetConfig,
  ECRunner,
  hasSeparateProtocol,
  isPox10Testnet,
  networkTypeOf,
  pox10NetworkOf,
  resolveNetworkConfig
} from '../enums.js';
import { isInitialized } from '../ipfs.js';
import EtnyContract from '../contract/operation/etnyContract.js';
import EcldContract from '../contract/operation/ecldContract.js';
import BloxbergProtocolContract from '../contract/operation/bloxbergProtocolContract.js';
import PolygonProtocolContract from '../contract/operation/polygonProtocolContract.js';
import contractBloxberg from '../contract/abi/etnyAbi.js';
import protocolContractPolygon from '../contract/abi/polygonProtocolAbi.js';

const BLOXBERG_POX10 = '0x69A7bEB5Da2d3dA711d52E491D71e51296b08745';
const BLOXBERG_POX10_REGISTRY = '0x7dBC1b591cc3b7136D863bc7430C6Db50E929665';
const BLOXBERG_TESTNET = '0x02882F03097fE8cD31afbdFbB5D72a498B41112c';
const AMOY_TOKEN = '0x9927809B61122B2af3f3b3A3303875e0687b8eE3';
const AMOY_POX20 = '0xd1182deA61CDa785C320cdBE5888EaC4178cAAF2';
const AMOY_POX20_REGISTRY = '0x0C0f52ebd72cd2d2cBe94F385c9e23cec528b706';
const AMOY_POX10 = '0x9Aad82557c84c11C4031382d8Bf2cacF8f256a02';
const AMOY_POX10_REGISTRY = '0xa2EE2a9118d0011AF05a6196c862D37d8c29F8eC';

// The V2 terms of a request (runner.v2TermsOf).
const V2_TERMS = { maxPricePerCuHourWei: 1n, maxGflops: 0n, relaysPerHour: 1n, gasLevel: 1n, escrowWei: 1n };

// A provider that answers the chain id and nothing else.
const providerOn = (chainId) => ({ getNetwork: async () => ({ chainId: BigInt(chainId) }) });

// A runner on `address` whose wallet is on `chainId`, its network resolved as
// a run resolves it, its events discarded and its image registry bound
// without the read of the enclave's details.
const runnerOn = async (address, chainId) => {
  const runner = new EthernityCloudRunner(address, { provider: providerOn(chainId) });
  runner.dispatchECEvent = () => {};
  runner.getEnclaveDetails = async () => {};
  await runner.resolveNetworkContext();
  return runner;
};

// The Amoy runner named onto the PoX 1.0 network.
const amoyPox10 = async () => {
  const runner = await runnerOn(AMOY_TOKEN, 80002);
  await runner.setNetwork('POLYGON', 'AMOY_POX10');
  return runner;
};

test('the bloxberg PoX 1.0 testnet network: chain 8995, the PoX its own token, the copy of the mainnet registry, the type TESTNET_POX10', () => {
  const cfg = ECPox10TestnetConfig.BLOXBERG;
  assert.equal(ECAddress.BLOXBERG.TESTNET_POX10_ADDRESS, BLOXBERG_POX10);
  assert.equal(cfg.tokenAddress, BLOXBERG_POX10);
  assert.equal(cfg.protocolAddress, BLOXBERG_POX10);
  assert.deepEqual(cfg.imageRegistry, { PYNITHY: BLOXBERG_POX10_REGISTRY, NODENITHY: BLOXBERG_POX10_REGISTRY });
  assert.equal(cfg.family, 'bloxberg');
  assert.equal(cfg.tokenName, 'tE10');
  assert.equal(cfg.isMainnet, false);
  assert.equal(cfg.networkName, 'bloxberg');
  assert.equal(cfg.networkKey, 'BLOXBERG');
  assert.equal(cfg.networkType, 'TESTNET_POX10');
  assert.equal(cfg.agentNetwork, undefined);
  assert.equal(cfg.faucet, null);
  assert.equal(ECRunner.BLOXBERG.PYNITHY_RUNNER_TESTNET_POX10, 'etny-pynithy-testnet-pox10');
  assert.equal(ECRunner.BLOXBERG.NODENITHY_RUNNER_TESTNET_POX10, 'etny-nodenithy-testnet-pox10');
  // As bloxberg mainnet's: the PoX is the token's own proxy.
  assert.equal(hasSeparateProtocol(cfg, cfg.tokenAddress), false);
  const mainnet = ECNetworkConfig[ECAddress.BLOXBERG.MAINNET_ADDRESS];
  assert.equal(hasSeparateProtocol(mainnet, ECAddress.BLOXBERG.MAINNET_ADDRESS), false);
  assert.equal(cfg.family, mainnet.family);
});

test('the Amoy PoX 1.0 testnet network: chain 80002, the PoX apart from the test ECLD, the copy of the mainnet registry, the type AMOY_POX10', () => {
  const cfg = ECPox10TestnetConfig.POLYGON;
  assert.equal(ECAddress.POLYGON.AMOY_POX10_PROTOCOL_ADDRESS, AMOY_POX10);
  assert.equal(ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.AMOY_POX10_ADDRESS, AMOY_POX10_REGISTRY);
  assert.equal(ECAddress.POLYGON.IMAGE_REGISTRY.NODENITHY.AMOY_POX10_ADDRESS, AMOY_POX10_REGISTRY);
  assert.equal(cfg.tokenAddress, AMOY_TOKEN);
  assert.equal(cfg.tokenAddress, ECAddress.POLYGON.TESTNET_ADDRESS);
  assert.equal(cfg.protocolAddress, AMOY_POX10);
  assert.deepEqual(cfg.imageRegistry, { PYNITHY: AMOY_POX10_REGISTRY, NODENITHY: AMOY_POX10_REGISTRY });
  assert.equal(cfg.family, 'ecld');
  assert.equal(cfg.tokenName, 'tECLD');
  assert.equal(cfg.isMainnet, false);
  assert.equal(cfg.networkName, 'amoy');
  assert.equal(cfg.networkKey, 'POLYGON');
  assert.equal(cfg.networkType, 'AMOY_POX10');
  assert.equal(cfg.agentNetwork, undefined);
  assert.deepEqual(cfg.faucet, { below: 100, amount: 1000 });
  assert.equal(ECRunner.POLYGON.PYNITHY_RUNNER_AMOY_POX10, 'ecld-pynithy-amoy-pox10');
  assert.equal(ECRunner.POLYGON.NODENITHY_RUNNER_AMOY_POX10, 'ecld-nodenithy-amoy-pox10');
  // As Polygon mainnet's: the PoX is a contract apart from the token.
  assert.equal(hasSeparateProtocol(cfg, cfg.tokenAddress), true);
  const mainnet = ECNetworkConfig[ECAddress.POLYGON.MAINNET_ADDRESS];
  assert.equal(hasSeparateProtocol(mainnet, ECAddress.POLYGON.MAINNET_ADDRESS), true);
  assert.equal(cfg.family, mainnet.family);
  // The token has no second name: the network has no constructor address of its own.
  assert.equal(ECAddress.POLYGON.AMOY_POX10_ADDRESS, undefined);
});

test('every network with PoX 1.0 testnet trustedzones has a descriptor, and its trustedzones name it', () => {
  assert.deepEqual(Object.keys(ECPox10TestnetConfig), ['BLOXBERG', 'POLYGON']);
  for (const [key, cfg] of Object.entries(ECPox10TestnetConfig)) {
    assert.equal(cfg.networkKey, key);
    assert.equal(networkTypeOf(cfg), cfg.networkType);
    assert.equal(isPox10Testnet(cfg), true);
    const pynithy = ECRunner[key][`PYNITHY_RUNNER_${cfg.networkType}`];
    const nodenithy = ECRunner[key][`NODENITHY_RUNNER_${cfg.networkType}`];
    assert.ok(pynithy && nodenithy, key);
    assert.equal(pox10NetworkOf(pynithy), key);
    assert.equal(pox10NetworkOf(nodenithy), key);
  }
  // No other ECRunner key carries a trustedzone under either type.
  for (const [key, zones] of Object.entries(ECRunner)) {
    const pox10 = ECPox10TestnetConfig[key];
    for (const type of ['TESTNET_POX10', 'AMOY_POX10']) {
      assert.equal(`PYNITHY_RUNNER_${type}` in zones, Boolean(pox10) && pox10.networkType === type, `${key} ${type}`);
    }
  }
  for (const other of ['etny-pynithy-testnet', 'etny-pynithy', 'ecld-pynithy-amoy', 'ecld-nodenithy', 'my-zone-pox10', '']) {
    assert.equal(pox10NetworkOf(other), undefined, other);
  }
  // A descriptor of the published tables is no PoX 1.0 testnet network and
  // names its type by isMainnet.
  for (const cfg of [...Object.values(ECNetworkConfig), ...Object.values(ECEcldTestnetConfig)]) {
    assert.equal(isPox10Testnet(cfg), false, cfg.networkName);
  }
  assert.equal(isPox10Testnet(undefined), false);
  assert.equal(networkTypeOf(ECNetworkConfig[BLOXBERG_TESTNET]), 'TESTNET');
  assert.equal(networkTypeOf(ECNetworkConfig[ECAddress.BLOXBERG.MAINNET_ADDRESS]), 'MAINNET');
});

test('resolution: the bloxberg PoX 1.0 token names its network; the Amoy token names the PoX 2.0 network unless the type names the PoX 1.0 one', () => {
  assert.equal(resolveNetworkConfig(BLOXBERG_POX10), ECPox10TestnetConfig.BLOXBERG);
  assert.equal(resolveNetworkConfig(BLOXBERG_POX10, 8995), ECPox10TestnetConfig.BLOXBERG);
  assert.equal(resolveNetworkConfig(BLOXBERG_POX10, 8995, 'TESTNET_POX10'), ECPox10TestnetConfig.BLOXBERG);
  for (const type of [undefined, 'TESTNET', 'TESTNET_UNSAFE']) {
    assert.equal(resolveNetworkConfig(AMOY_TOKEN, 80002, type), ECNetworkConfig[AMOY_TOKEN], String(type));
    assert.equal(resolveNetworkConfig(AMOY_TOKEN, undefined, type), ECNetworkConfig[AMOY_TOKEN], String(type));
  }
  assert.equal(ECNetworkConfig[AMOY_TOKEN].protocolAddress, AMOY_POX20);
  assert.equal(resolveNetworkConfig(AMOY_TOKEN, 80002, 'AMOY_POX10'), ECPox10TestnetConfig.POLYGON);
  assert.equal(resolveNetworkConfig(AMOY_TOKEN, undefined, 'AMOY_POX10'), ECPox10TestnetConfig.POLYGON);
  // A token that pays for no PoX 1.0 testnet network of the type names none.
  assert.equal(resolveNetworkConfig(AMOY_TOKEN, 80002, 'TESTNET_POX10'), undefined);
  assert.equal(resolveNetworkConfig(BLOXBERG_POX10, 8995, 'AMOY_POX10'), undefined);
  assert.equal(resolveNetworkConfig(BLOXBERG_TESTNET, 8995, 'TESTNET_POX10'), undefined);
  assert.equal(resolveNetworkConfig(ECAddress.BLOXBERG.MAINNET_ADDRESS, 8995, 'TESTNET_POX10'), undefined);
  assert.equal(resolveNetworkConfig(ECAddress.POLYGON.MAINNET_ADDRESS, 137, 'AMOY_POX10'), undefined);
});

test('a runner on the bloxberg PoX 1.0 token is built as a bloxberg mainnet runner is: the token as PoX, the legacy ABI', async () => {
  const runner = await runnerOn(BLOXBERG_POX10, 8995);
  assert.equal(runner.networkConfig, ECPox10TestnetConfig.BLOXBERG);
  assert.ok(runner.tokenContract instanceof EtnyContract);
  assert.equal(runner.tokenContract.contractAddress(), BLOXBERG_POX10);
  assert.equal(runner.tokenContract.tokenName, 'tE10');
  assert.ok(runner.protocolContract instanceof BloxbergProtocolContract);
  assert.equal(runner.protocolContract.getContract().target, BLOXBERG_POX10);
  assert.equal(runner.protocolContract.etnyContactWithProvider.target, BLOXBERG_POX10);
  assert.equal(runner.protocolAbi, contractBloxberg.abi);
  assert.equal(runner.isMainnet(), false);
  assert.equal(runner.isUnsafe(), false);
  assert.equal(runner.resolveTrustedZoneImage(), 'etny-pynithy-testnet-pox10');
  await runner.initializeImageRegistry('a-securelock');
  assert.equal(runner.imageRegistryContract.getContract().target, BLOXBERG_POX10_REGISTRY);
  // The request takes its escrow in the same call: no approval is sent.
  runner.resources = { taskPrice: 3, duration: 1, validators: 1 };
  runner.tokenContract.checkAndSetAllowance = async () => assert.fail('approved');
  await runner.checkAllowance();
  // The PoX takes no V2 request.
  assert.throws(() => runner.selectRequestTerms(V2_TERMS),
    { message: 'options.v2: BLOXBERG TESTNET_POX10 is a PoX 1.0 network, whose PoX takes no V2 request' });
  // A result is this order's when it is addressed to the copy's PoX on chain 8995.
  runner.orderId = 7;
  assert.equal(await runner.resultBindingError({ orderId: 7n, to: BLOXBERG_POX10, chainId: 8995n }), null);
  assert.match(await runner.resultBindingError({ orderId: 7n, to: ECAddress.BLOXBERG.MAINNET_ADDRESS, chainId: 8995n }),
    /not 0x69A7bEB5Da2d3dA711d52E491D71e51296b08745/);
});

test('the bloxberg PoX 1.0 network takes its own name and no other; no other bloxberg address takes its name', async () => {
  const runner = await runnerOn(BLOXBERG_POX10, 8995);
  const protocol = runner.protocolContract;
  await runner.setNetwork('BLOXBERG', 'TESTNET_POX10');
  assert.equal(runner.networkConfig, ECPox10TestnetConfig.BLOXBERG);
  assert.equal(runner.protocolContract, protocol);
  assert.equal(runner.resolveTrustedZoneImage(), 'etny-pynithy-testnet-pox10');
  for (const type of ['TESTNET', 'TESTNET_UNSAFE']) {
    await assert.rejects(runner.setNetwork('BLOXBERG', type), {
      message: `setNetwork: BLOXBERG ${type} is not the network of this runner's address (BLOXBERG TESTNET_POX10)`
    });
  }
  await assert.rejects(runner.setNetwork('BLOXBERG', 'MAINNET'), {
    message: "setNetwork: BLOXBERG MAINNET is not on the chain of this runner's address (BLOXBERG TESTNET_POX10)"
  });
  await assert.rejects(runner.setNetwork('POLYGON', 'AMOY_POX10'), {
    message: "setNetwork: POLYGON AMOY_POX10 is not on the chain of this runner's address (BLOXBERG TESTNET_POX10)"
  });
  assert.equal(runner.networkConfig, ECPox10TestnetConfig.BLOXBERG);
  assert.equal(runner.resolveTrustedZoneImage(), 'etny-pynithy-testnet-pox10');

  // The tETNY token is the PoX 2.0 network's: the PoX 1.0 name is refused on it.
  const testnet = await runnerOn(BLOXBERG_TESTNET, 8995);
  await assert.rejects(testnet.setNetwork('BLOXBERG', 'TESTNET_POX10'), {
    message: `setNetwork: BLOXBERG TESTNET_POX10 is paid with the token ${BLOXBERG_POX10}: construct the runner with that address`
  });
  assert.equal(testnet.networkConfig, ECNetworkConfig[BLOXBERG_TESTNET]);
  assert.equal(testnet.resolveTrustedZoneImage(), 'etny-pynithy-testnet');
  const mainnet = await runnerOn(ECAddress.BLOXBERG.MAINNET_ADDRESS, 8995);
  await assert.rejects(mainnet.setNetwork('BLOXBERG', 'TESTNET_POX10'), {
    message: "setNetwork: BLOXBERG TESTNET_POX10 is not on the chain of this runner's address (BLOXBERG MAINNET)"
  });
});

test('a runner on the Amoy token is on the PoX 2.0 network until the PoX 1.0 network is named', async () => {
  const runner = await runnerOn(AMOY_TOKEN, 80002);
  assert.equal(runner.networkConfig, ECNetworkConfig[AMOY_TOKEN]);
  assert.equal(runner.protocolContract.getContract().target, AMOY_POX20);
  assert.equal(runner.resolveTrustedZoneImage(), 'ecld-pynithy-amoy');
  assert.equal(runner.networkConfig.agentNetwork, 'polygon_amoy');
  await runner.initializeImageRegistry('a-securelock');
  assert.equal(runner.imageRegistryContract.getContract().target, AMOY_POX20_REGISTRY);
  // The network resolution a run starts with keeps the runner on the PoX 2.0 network.
  await runner.resolveNetworkContext();
  assert.equal(runner.networkConfig, ECNetworkConfig[AMOY_TOKEN]);
  assert.equal(runner.protocolContract.getContract().target, AMOY_POX20);
});

test('setNetwork(POLYGON, AMOY_POX10) puts the Amoy runner on the PoX 1.0 network, built as a Polygon mainnet runner is', async () => {
  const runner = await amoyPox10();
  assert.equal(runner.networkConfig, ECPox10TestnetConfig.POLYGON);
  assert.ok(runner.tokenContract instanceof EcldContract);
  assert.equal(runner.tokenContract.contractAddress(), AMOY_TOKEN);
  assert.equal(runner.tokenContract.tokenName, 'tECLD');
  assert.ok(runner.protocolContract instanceof PolygonProtocolContract);
  assert.equal(runner.protocolContract.getContract().target, AMOY_POX10);
  assert.equal(runner.protocolContract.protocolContractWithProvider.target, AMOY_POX10);
  assert.equal(runner.protocolAbi, protocolContractPolygon.abi);
  assert.equal(runner.isMainnet(), false);
  assert.equal(runner.isUnsafe(), false);
  assert.equal(runner.resolveTrustedZoneImage(), 'ecld-pynithy-amoy-pox10');
  await runner.initializeImageRegistry('a-securelock');
  assert.equal(runner.imageRegistryContract.getContract().target, AMOY_POX10_REGISTRY);
  // The PoX pulls the escrow: the approval names the PoX 1.0 contract.
  const approvals = [];
  runner.resources = { taskPrice: 5, duration: 1, validators: 1 };
  runner.tokenContract.checkAndSetAllowance = async (protocol, escrow) => { approvals.push([protocol, escrow]); return true; };
  await runner.checkAllowance();
  assert.deepEqual(approvals, [[AMOY_POX10, '5']]);
  // A result is this order's when it is addressed to the PoX 1.0 contract.
  runner.orderId = 7;
  assert.equal(await runner.resultBindingError({ orderId: 7n, to: AMOY_POX10, chainId: 80002n }), null);
  assert.match(await runner.resultBindingError({ orderId: 7n, to: AMOY_POX20, chainId: 80002n }),
    /addressed to 0xd1182deA61CDa785C320cdBE5888EaC4178cAAF2, not 0x9Aad82557c84c11C4031382d8Bf2cacF8f256a02/);
});

test('a PoX 1.0 testnet network takes no V2 request: options.v2 ends the run before any request reaches the chain', async () => {
  const resources = { taskPrice: 3, duration: 1, validators: 1 };
  const refusals = [
    [await amoyPox10(), 'options.v2: POLYGON AMOY_POX10 is a PoX 1.0 network, whose PoX takes no V2 request'],
    [await runnerOn(BLOXBERG_POX10, 8995), 'options.v2: BLOXBERG TESTNET_POX10 is a PoX 1.0 network, whose PoX takes no V2 request']
  ];
  for (const [runner, message] of refusals) {
    assert.throws(() => runner.selectRequestTerms(V2_TERMS), { message });
    // The provider of these runners answers the chain id alone: a balance
    // read, an allowance read or a transaction would fail with another error.
    await assert.rejects(runner.run(resources, 'a-securelock', 'code', '', null, { v2: V2_TERMS }), { message });
    await assert.rejects(runner.runSession(resources, 'a-securelock', 'code', '', null, { v2: V2_TERMS }), { message });
    assert.equal(runner.v2Terms, null);
  }
  // The Amoy runner named back onto the PoX 2.0 network takes V2 terms, and
  // a Polygon mainnet runner is judged as published, by its PoX being apart
  // from its token.
  const amoy = await amoyPox10();
  await amoy.setNetwork('POLYGON', 'TESTNET');
  amoy.selectRequestTerms(V2_TERMS);
  assert.deepEqual(amoy.v2Terms, V2_TERMS);
  const mainnet = await runnerOn(ECAddress.POLYGON.MAINNET_ADDRESS, 137);
  mainnet.selectRequestTerms(V2_TERMS);
  assert.deepEqual(mainnet.v2Terms, V2_TERMS);
});

test('a PoX 1.0 testnet network is on one chain: on a wallet of another chain the network resolution of a run is refused with both chain ids', async () => {
  const walletOn = (address, chainId) => {
    const runner = new EthernityCloudRunner(address, { provider: providerOn(chainId) });
    runner.dispatchECEvent = () => {};
    return runner;
  };
  const resources = { taskPrice: 3, duration: 1, validators: 1 };
  // The bloxberg copy's token on a wallet of Amoy, of Polygon mainnet and of
  // Sepolia, a chain whose id alone names a descriptor.
  for (const chainId of [80002, 137, 11155111]) {
    const runner = walletOn(BLOXBERG_POX10, chainId);
    const message = `BLOXBERG TESTNET_POX10 is on chain 8995 and the wallet is on chain ${chainId}: switch the wallet to chain 8995`;
    await assert.rejects(runner.resolveNetworkContext(), { message });
    await assert.rejects(runner.run(resources, 'a-securelock', 'code'), { message });
    assert.equal(runner.networkConfig, ECPox10TestnetConfig.BLOXBERG);
    assert.equal(runner.protocolContract.getContract().target, BLOXBERG_POX10);
  }
  // The Amoy token named onto the PoX 1.0 network on a wallet of Polygon
  // mainnet, of bloxberg and of LitVM.
  for (const chainId of [137, 8995, 4441]) {
    const runner = walletOn(AMOY_TOKEN, chainId);
    await runner.setNetwork('POLYGON', 'AMOY_POX10');
    const message = `POLYGON AMOY_POX10 is on chain 80002 and the wallet is on chain ${chainId}: switch the wallet to chain 80002`;
    await assert.rejects(runner.resolveNetworkContext(), { message });
    await assert.rejects(runner.run(resources, 'a-securelock', 'code'), { message });
    await assert.rejects(runner.attachSession(1), { message });
    assert.equal(runner.networkConfig, ECPox10TestnetConfig.POLYGON);
    assert.equal(runner.protocolContract.getContract().target, AMOY_POX10);
  }
  // On the network's chain the resolution keeps the runner on it.
  const bloxberg = walletOn(BLOXBERG_POX10, 8995);
  await bloxberg.resolveNetworkContext();
  assert.equal(bloxberg.networkConfig, ECPox10TestnetConfig.BLOXBERG);
  const amoy = walletOn(AMOY_TOKEN, 80002);
  await amoy.setNetwork('POLYGON', 'AMOY_POX10');
  await amoy.resolveNetworkContext();
  assert.equal(amoy.networkConfig, ECPox10TestnetConfig.POLYGON);
  // A published network is resolved as published: the Amoy token on a wallet
  // of Polygon mainnet stays the Amoy testnet's descriptor, with no refusal.
  const published = walletOn(AMOY_TOKEN, 137);
  await published.resolveNetworkContext();
  assert.equal(published.networkConfig, ECNetworkConfig[AMOY_TOKEN]);
});

test('the named PoX 1.0 network is kept by the network resolution of a run, and the names of the PoX 2.0 network put the runner back on it', async () => {
  const runner = await amoyPox10();
  // What run() does first, on every run.
  await runner.resolveNetworkContext();
  await runner.resolveNetworkContext();
  assert.equal(runner.networkConfig, ECPox10TestnetConfig.POLYGON);
  assert.equal(runner.protocolContract.getContract().target, AMOY_POX10);
  assert.equal(runner.chainId, 80002);

  for (const [type, trustedZone, unsafe] of [['TESTNET', 'ecld-pynithy-amoy', false], ['TESTNET_UNSAFE', 'ecld-pynithy-amoy-unsafe', true]]) {
    await runner.setNetwork('POLYGON', type);
    assert.equal(runner.networkConfig, ECNetworkConfig[AMOY_TOKEN], type);
    assert.equal(runner.protocolContract.getContract().target, AMOY_POX20, type);
    assert.equal(runner.resolveTrustedZoneImage(), trustedZone, type);
    assert.equal(runner.isUnsafe(), unsafe, type);
    await runner.resolveNetworkContext();
    assert.equal(runner.networkConfig, ECNetworkConfig[AMOY_TOKEN], type);
    await runner.initializeImageRegistry('a-securelock');
    assert.equal(runner.imageRegistryContract.getContract().target, AMOY_POX20_REGISTRY, type);

    await runner.setNetwork('polygon', 'amoy_pox10');
    assert.equal(runner.networkConfig, ECPox10TestnetConfig.POLYGON, type);
    assert.equal(runner.protocolContract.getContract().target, AMOY_POX10, type);
    assert.equal(runner.resolveTrustedZoneImage(), 'ecld-pynithy-amoy-pox10', type);
    assert.equal(runner.isUnsafe(), false, type);
  }
  await assert.rejects(runner.setNetwork('POLYGON', 'MAINNET'), {
    message: "setNetwork: POLYGON MAINNET is not on the chain of this runner's address (POLYGON AMOY_POX10)"
  });
  await assert.rejects(runner.setNetwork('BLOXBERG', 'TESTNET_POX10'), {
    message: "setNetwork: BLOXBERG TESTNET_POX10 is not on the chain of this runner's address (POLYGON AMOY_POX10)"
  });
  // The Polygon mainnet token pays for no PoX 1.0 testnet network.
  const mainnet = await runnerOn(ECAddress.POLYGON.MAINNET_ADDRESS, 137);
  await assert.rejects(mainnet.setNetwork('POLYGON', 'AMOY_POX10'), {
    message: "setNetwork: POLYGON AMOY_POX10 is not on the chain of this runner's address (POLYGON MAINNET)"
  });
});

test('(POLYGON, TESTNET_POX10) is no name of a network: it is refused on every runner, and the runner stays where it is', async () => {
  const refusal = { message: 'setNetwork: POLYGON TESTNET_POX10 is not a network this runner knows' };
  const amoy = await runnerOn(AMOY_TOKEN, 80002);
  await assert.rejects(amoy.setNetwork('POLYGON', 'TESTNET_POX10'), refusal);
  assert.equal(amoy.networkConfig, ECNetworkConfig[AMOY_TOKEN]);
  assert.equal(amoy.protocolContract.getContract().target, AMOY_POX20);
  assert.equal(amoy.networkType, undefined);

  const onPox10 = await amoyPox10();
  await assert.rejects(onPox10.setNetwork('POLYGON', 'TESTNET_POX10'), refusal);
  await assert.rejects(onPox10.setNetwork('polygon', 'testnet_pox10'), {
    message: 'setNetwork: polygon testnet_pox10 is not a network this runner knows'
  });
  assert.equal(onPox10.networkConfig, ECPox10TestnetConfig.POLYGON);
  assert.equal(onPox10.networkType, 'AMOY_POX10');

  const mainnet = await runnerOn(ECAddress.POLYGON.MAINNET_ADDRESS, 137);
  await assert.rejects(mainnet.setNetwork('POLYGON', 'TESTNET_POX10'), refusal);
  // Its trustedzones are named by AMOY_POX10 alone.
  assert.equal(ECRunner.POLYGON.PYNITHY_RUNNER_TESTNET_POX10, undefined);
  assert.equal(ECRunner.POLYGON.NODENITHY_RUNNER_TESTNET_POX10, undefined);
});

test('a PoX 1.0 testnet network runs its two trustedzones and no other', async () => {
  const bloxberg = await runnerOn(BLOXBERG_POX10, 8995);
  for (const zone of [null, 'etny-pynithy-testnet-pox10', 'etny-nodenithy-testnet-pox10']) {
    assert.doesNotThrow(() => bloxberg.selectTrustedZone(zone), String(zone));
  }
  for (const zone of ['etny-pynithy-testnet', 'etny-pynithy', 'ecld-pynithy-amoy-pox10']) {
    assert.throws(() => bloxberg.selectTrustedZone(zone), {
      message: `BLOXBERG TESTNET_POX10 runs only its PoX 1.0 trustedzones (etny-pynithy-testnet-pox10, etny-nodenithy-testnet-pox10), and ${zone} is not one of them`
    });
  }
  assert.throws(() => bloxberg.selectTrustedZone('etny-pynithy-testnet-unsafe'), {
    message: 'etny-pynithy-testnet-unsafe runs without a CAS, and this network has no -unsafe network'
  });

  const amoy = await amoyPox10();
  for (const zone of [null, 'ecld-pynithy-amoy-pox10', 'ecld-nodenithy-amoy-pox10']) {
    assert.doesNotThrow(() => amoy.selectTrustedZone(zone), String(zone));
  }
  for (const zone of ['ecld-pynithy-amoy', 'ecld-nodenithy', 'etny-pynithy-testnet-pox10']) {
    assert.throws(() => amoy.selectTrustedZone(zone), {
      message: `POLYGON AMOY_POX10 runs only its PoX 1.0 trustedzones (ecld-pynithy-amoy-pox10, ecld-nodenithy-amoy-pox10), and ${zone} is not one of them`
    });
  }
  assert.throws(() => amoy.selectTrustedZone('ecld-pynithy-amoy-unsafe'), {
    message: 'ecld-pynithy-amoy-unsafe runs without a CAS, and this network has no -unsafe network'
  });
});

test('a PoX 1.0 testnet trustedzone runs on no other network: the run is refused with the way to name its network', async () => {
  const amoy = await runnerOn(AMOY_TOKEN, 80002);
  for (const zone of ['ecld-pynithy-amoy-pox10', 'ecld-nodenithy-amoy-pox10']) {
    assert.throws(() => amoy.selectTrustedZone(zone), {
      message: `${zone} is a trustedzone of the PoX 1.0 network POLYGON AMOY_POX10: construct the runner with that network's token ${AMOY_TOKEN} and name the network with setNetwork('POLYGON', 'AMOY_POX10')`
    });
  }
  for (const [address, chainId] of [[BLOXBERG_TESTNET, 8995], [ECAddress.BLOXBERG.MAINNET_ADDRESS, 8995], [ECAddress.POLYGON.MAINNET_ADDRESS, 137]]) {
    const runner = await runnerOn(address, chainId);
    assert.throws(() => runner.selectTrustedZone('etny-nodenithy-testnet-pox10'), {
      message: `etny-nodenithy-testnet-pox10 is a trustedzone of the PoX 1.0 network BLOXBERG TESTNET_POX10: construct the runner with that network's token ${BLOXBERG_POX10} and name the network with setNetwork('BLOXBERG', 'TESTNET_POX10')`
    }, address);
  }
  // The Amoy PoX 2.0 network takes its own trustedzones.
  assert.doesNotThrow(() => amoy.selectTrustedZone('ecld-nodenithy-amoy'));
  assert.doesNotThrow(() => amoy.selectTrustedZone(null));
  assert.throws(() => amoy.selectTrustedZone('ecld-pynithy-amoy-unsafe'), {
    message: "ecld-pynithy-amoy-unsafe runs without a CAS: run it on the -unsafe network, setNetwork('POLYGON', 'TESTNET_UNSAFE')"
  });
});

test('neither PoX 1.0 testnet network has an intake route: a run without a storage is refused before any transaction', async () => {
  assert.equal(isInitialized(), false);
  const bloxberg = await runnerOn(BLOXBERG_POX10, 8995);
  assert.throws(() => bloxberg.initializeDefaultStorage(), (e) => {
    assert.match(e.message, /^BLOXBERG TESTNET_POX10 has no payload intake route: configure the storage before submitting a task/);
    return true;
  });
  assert.throws(() => bloxberg.initializePublicIntake(), { message: 'initializePublicIntake: this network has no payload intake route' });
  const amoy = await amoyPox10();
  assert.throws(() => amoy.initializeDefaultStorage(), (e) => {
    assert.match(e.message, /^POLYGON AMOY_POX10 has no payload intake route: configure the storage before submitting a task/);
    return true;
  });
  assert.throws(() => amoy.initializePublicIntake(), { message: 'initializePublicIntake: this network has no payload intake route' });
  assert.equal(isInitialized(), false);
});
