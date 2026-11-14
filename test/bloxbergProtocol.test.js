// The bloxberg testnet's PoX is the EthernityImplementationV2 1.2 at
// ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS, a contract apart from the tETNY
// token proxy, which pulls a DO request's escrow with transferFrom; bloxberg
// mainnet's PoX is the ETNY proxy itself. The runner picks the protocol
// contract class, the result ABI and the approval step on the protocol address
// differing from the token address (hasSeparateProtocol), not on the network's
// name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import {
  ECAddress,
  ECNetworkConfig,
  ECEcldTestnetConfig,
  ECLD_SHARED_TESTNET_TOKEN,
  hasSeparateProtocol,
  resolveNetworkConfig
} from '../enums.js';
import EtnyContract from '../contract/operation/etnyContract.js';
import EcldContract from '../contract/operation/ecldContract.js';
import BloxbergProtocolContract from '../contract/operation/bloxbergProtocolContract.js';
import PolygonProtocolContract from '../contract/operation/polygonProtocolContract.js';
import contractBloxberg from '../contract/abi/etnyAbi.js';
import protocolContractPolygon from '../contract/abi/polygonProtocolAbi.js';

const TOKEN = ECAddress.BLOXBERG.TESTNET_ADDRESS;
const POX = ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS;
const MAINNET = ECAddress.BLOXBERG.MAINNET_ADDRESS;
const WALLET = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';

// A provider that answers the chain id and nothing else.
const providerOn = (chainId) => ({ getNetwork: async () => ({ chainId: BigInt(chainId) }) });

// A runner on `address` with its network resolved, its events discarded.
const runnerOn = async (address, chainId, explicitChainId) => {
  const runner = new EthernityCloudRunner(address, { provider: providerOn(chainId) }, explicitChainId);
  runner.dispatchECEvent = () => {};
  await runner.resolveNetworkContext();
  return runner;
};

test('the bloxberg testnet descriptor names the 1.2 implementation as its PoX, apart from the token; the mainnet descriptor names the token', () => {
  const testnet = resolveNetworkConfig(TOKEN);
  assert.equal(testnet.protocolAddress, POX);
  assert.equal(POX, '0x7E7C6eB435E3687CfDfe18C09C0340eb70567d7b');
  assert.equal(TOKEN, '0x02882F03097fE8cD31afbdFbB5D72a498B41112c');
  assert.notEqual(testnet.protocolAddress, TOKEN);
  assert.equal(testnet.family, 'bloxberg');
  const mainnet = resolveNetworkConfig(MAINNET);
  assert.equal(mainnet.protocolAddress, MAINNET);
  assert.equal(mainnet.family, 'bloxberg');
});

test('hasSeparateProtocol: the bloxberg testnet and the ecld networks, not bloxberg mainnet nor an unresolved descriptor', () => {
  assert.equal(hasSeparateProtocol(ECNetworkConfig[TOKEN], TOKEN), true);
  assert.equal(hasSeparateProtocol(ECNetworkConfig[MAINNET], MAINNET), false);
  assert.equal(hasSeparateProtocol(ECNetworkConfig[ECAddress.POLYGON.TESTNET_ADDRESS], ECAddress.POLYGON.TESTNET_ADDRESS), true);
  assert.equal(hasSeparateProtocol(ECNetworkConfig[ECAddress.POLYGON.MAINNET_ADDRESS], ECAddress.POLYGON.MAINNET_ADDRESS), true);
  assert.equal(hasSeparateProtocol(ECEcldTestnetConfig[4690], ECLD_SHARED_TESTNET_TOKEN), true);
  assert.equal(hasSeparateProtocol(ECEcldTestnetConfig[4441], ECLD_SHARED_TESTNET_TOKEN), true);
  assert.equal(hasSeparateProtocol(ECEcldTestnetConfig[11155111], ECAddress.SEPOLIA.TESTNET_ADDRESS), true);
  // The shared token before its chainId is known: no protocol address yet.
  assert.equal(hasSeparateProtocol(resolveNetworkConfig(ECLD_SHARED_TESTNET_TOKEN), ECLD_SHARED_TESTNET_TOKEN), false);
  assert.equal(hasSeparateProtocol(undefined, TOKEN), false);
  // The comparison ignores the checksum case.
  assert.equal(hasSeparateProtocol({ protocolAddress: MAINNET.toLowerCase() }, MAINNET), false);
  assert.equal(hasSeparateProtocol({ protocolAddress: POX.toLowerCase() }, TOKEN), true);
});

test('a bloxberg testnet runner pays with the tETNY proxy and posts to the 1.2 implementation with the V2 ABI', async () => {
  const runner = await runnerOn(TOKEN, 8995);
  assert.equal(runner.networkConfig, ECNetworkConfig[TOKEN]);
  assert.ok(runner.tokenContract instanceof EtnyContract);
  assert.equal(runner.tokenContract.getContract().target, TOKEN);
  assert.ok(runner.protocolContract instanceof PolygonProtocolContract);
  assert.equal(runner.protocolContract.getContract().target, POX);
  assert.equal(runner.protocolContract.protocolContractWithProvider.target, POX);
  assert.equal(runner.protocolContract.contractAddress(), POX);
  assert.equal(runner.protocolAbi, protocolContractPolygon.abi);
  // The V2 ABI answers every call the runner makes on the PoX.
  const iface = runner.protocolContract.getContract().interface;
  for (const fn of ['_addDORequest', '_getOrder', '_approveOrder', '_cancelDORequest', '_getResultFromOrder',
    '_getMyDPRequests', '_getOrdersCount', '_getDORequest', '_getDORequestMetadata', '_getDPRequestMetadata',
    '_getMyDOOrders', '_addMetadataToRequest', '_addResultToOrder', 'erc20Address']) {
    assert.ok(iface.hasFunction(fn), fn);
  }
  for (const ev of ['_addDORequestEV', '_orderPlacedEV', '_orderApprovedEV', '_orderClosedEV']) {
    assert.ok(iface.hasEvent(ev), ev);
  }
});

test('a bloxberg mainnet runner keeps the ETNY proxy as both token and PoX, with the legacy ABI', async () => {
  const runner = await runnerOn(MAINNET, 8995);
  assert.ok(runner.tokenContract instanceof EtnyContract);
  assert.equal(runner.tokenContract.getContract().target, MAINNET);
  assert.ok(runner.protocolContract instanceof BloxbergProtocolContract);
  assert.equal(runner.protocolContract.getContract().target, MAINNET);
  assert.equal(runner.protocolContract.etnyContactWithProvider.target, MAINNET);
  assert.equal(runner.protocolAbi, contractBloxberg.abi);
});

test('an ecld runner is built as before: the ECLD token and the V2 PoX at the protocol address, once that is known', async () => {
  const amoy = await runnerOn(ECAddress.POLYGON.TESTNET_ADDRESS, 80002);
  assert.ok(amoy.tokenContract instanceof EcldContract);
  assert.ok(amoy.protocolContract instanceof PolygonProtocolContract);
  assert.equal(amoy.protocolContract.getContract().target, ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS);
  assert.equal(amoy.protocolAbi, protocolContractPolygon.abi);
  // The shared token: no protocol contract until the chainId names the network.
  const litvm = new EthernityCloudRunner(ECLD_SHARED_TESTNET_TOKEN, { provider: providerOn(4441) });
  assert.equal(litvm.protocolContract, undefined);
  assert.equal(litvm.protocolAbi, undefined);
  await litvm.resolveNetworkContext();
  assert.ok(litvm.protocolContract instanceof PolygonProtocolContract);
  assert.equal(litvm.protocolContract.getContract().target, ECAddress.LITVM.TESTNET_PROTOCOL_ADDRESS);
  assert.equal(litvm.protocolAbi, protocolContractPolygon.abi);
});

test('checkAllowance approves the PoX on the token where the two differ and skips it where the PoX is the token', async () => {
  const approvals = [];
  const recording = (runner) => {
    runner.tokenContract.checkAndSetAllowance = async (protocol, amount, price) => {
      approvals.push([protocol, amount, price]);
      return true;
    };
    return runner;
  };
  const testnet = recording(await runnerOn(TOKEN, 8995));
  await testnet.checkAllowance(3);
  assert.deepEqual(approvals, [[POX, '100', '3']]);

  const mainnet = recording(await runnerOn(MAINNET, 8995));
  await mainnet.checkAllowance(3);
  assert.equal(approvals.length, 1);

  const amoy = recording(await runnerOn(ECAddress.POLYGON.TESTNET_ADDRESS, 80002));
  await amoy.checkAllowance(5);
  assert.deepEqual(approvals[1], [ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS, '100', '5']);

  const litvm = recording(await runnerOn(ECLD_SHARED_TESTNET_TOKEN, 4441, 4441));
  await litvm.checkAllowance(2);
  assert.deepEqual(approvals[2], [ECAddress.LITVM.TESTNET_PROTOCOL_ADDRESS, '100', '2']);

  // An approval that is not mined fails the run before the request is sent.
  testnet.tokenContract.checkAndSetAllowance = async () => false;
  await assert.rejects(testnet.checkAllowance(3), /Unable to set allowance/);
});

test('EtnyContract.checkAndSetAllowance approves the PoX when the allowance is below the task price and leaves a sufficient one alone', async () => {
  const token = new EtnyContract(TOKEN, { provider: providerOn(8995), signer: { getAddress: async () => WALLET } });
  const calls = [];
  let allowance = 0n;
  token.etnyContract = {
    allowance: async (owner, spender) => {
      calls.push(['allowance', owner, spender]);
      return allowance;
    },
    approve: async (spender, amount) => {
      calls.push(['approve', spender, amount]);
      return { hash: '0xa', wait: async () => { allowance = amount; return { status: 1 }; } };
    }
  };
  assert.equal(await token.checkAndSetAllowance(POX, '100', '3'), true);
  assert.deepEqual(calls, [
    ['allowance', WALLET, POX],
    ['approve', POX, ethers.parseUnits('100', 'ether')]
  ]);
  assert.equal(allowance, ethers.parseUnits('100', 'ether'));

  calls.length = 0;
  assert.equal(await token.checkAndSetAllowance(POX, '100', '3'), true);
  assert.deepEqual(calls, [['allowance', WALLET, POX]]);

  // The allowance covers 100 tokens; a task priced above it is approved again.
  calls.length = 0;
  assert.equal(await token.checkAndSetAllowance(POX, '500', '200'), true);
  assert.deepEqual(calls.map((c) => c[0]), ['allowance', 'approve']);
  assert.equal(allowance, ethers.parseUnits('500', 'ether'));

  // An approval transaction that is not mined.
  allowance = 0n;
  token.etnyContract.approve = async () => ({ hash: '0xb', wait: async () => { throw new Error('transaction replaced'); } });
  assert.equal(await token.checkAndSetAllowance(POX, '100', '3'), false);
});

test('a bloxberg testnet result is bound to the 1.2 implementation: one addressed to the token proxy is refused', async () => {
  const runner = await runnerOn(TOKEN, 8995);
  runner.orderId = 7;
  assert.match(
    await runner.resultBindingError({ orderId: 7n, to: TOKEN, chainId: 8995n }),
    /addressed to 0x02882F03097fE8cD31afbdFbB5D72a498B41112c, not 0x7E7C6eB435E3687CfDfe18C09C0340eb70567d7b/
  );
  assert.equal(await runner.resultBindingError({ orderId: 7n, to: POX.toLowerCase(), chainId: 8995n }), null);
  assert.equal(await runner.resultBindingError({ orderId: 7n, to: POX, chainId: 0n }), null);
  assert.match(await runner.resultBindingError({ orderId: 7n, to: POX, chainId: 80002n }), /signed for chain 80002/);
  assert.match(await runner.resultBindingError({ orderId: 8n, to: POX, chainId: 8995n }), /for order 8/);

  // On mainnet the proxy is the PoX, so a result addressed to it is this order's.
  const mainnet = await runnerOn(MAINNET, 8995);
  mainnet.orderId = 7;
  assert.equal(await mainnet.resultBindingError({ orderId: 7n, to: MAINNET, chainId: 8995n }), null);
  assert.match(await mainnet.resultBindingError({ orderId: 7n, to: POX, chainId: 8995n }), /not 0x549A6E06BB2084100148D50F51CF77a3436C3Ae7/);
});
