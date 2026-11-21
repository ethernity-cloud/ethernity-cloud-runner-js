// A run with options.v2 (run() and runSession()) posts its DO request through
// the PoX 2.0's addDORequestV2 with the terms given (maxPricePerCuHourWei,
// maxGflops, relaysPerHour, gasLevel), checks the wallet's balance in wei against
// the escrow and raises the token allowance to that exact escrow; a run
// without it is the legacy request (the balance and the allowance checked
// against taskPrice x validators x duration, the escrow _addDORequest
// takes). V2 terms need a PoX apart from the token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner, { V2_TERM_FIELDS, v2TermsOf } from '../runner.js';
import { ECAddress } from '../enums.js';
import PolygonProtocolContract from '../contract/operation/polygonProtocolContract.js';
import protocolContractPolygon from '../contract/abi/polygonProtocolAbi.js';
import { GAS_HEADROOM_PERCENT } from '../utils.js';

const TOKEN = ECAddress.BLOXBERG.TESTNET_ADDRESS;
const POX = ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS;
const MAINNET = ECAddress.BLOXBERG.MAINNET_ADDRESS;
const NODE = '0xB78804B94a49579e8c4e1A98e9e965BF3D15062F';
const WALLET = '0xF79648481c486406F0872401bDCfdA2d6152a6E1';

// The plan's A10 request on bloxberg: 0.3 tETNY per CU-hour for at most
// 0.1 CU (maxGflops 10) over one hour at 17 % fees, plus the chain fee of the
// result alone (974,520 gas x 2,000,000 wei x 1e18 / 1e18).
const TERMS = {
  maxPricePerCuHourWei: ethers.parseEther('0.3'),
  maxGflops: 10,
  relaysPerHour: 0,
  gasLevel: '1000000000000000000',
  escrowWei: ethers.parseEther('0.0351') + 1949040000000n
};
const ESCROW_TOKENS = ethers.formatEther(TERMS.escrowWei);
const RESOURCES = { taskPrice: 3, cpu: 1, memory: 1, storage: 10, bandwidth: 1, duration: 1, validators: 1 };

const providerOn = (chainId) => ({ getNetwork: async () => ({ chainId: BigInt(chainId) }) });

// A runner of the wallet WALLET on the network of `address`; the balance
// check resolves the wallet's address from the signer before its read.
const runnerOn = async (address, chainId) => {
  const runner = new EthernityCloudRunner(address, { provider: providerOn(chainId), signer: { getAddress: async () => WALLET } });
  runner.dispatchECEvent = () => {};
  await runner.resolveNetworkContext();
  return runner;
};

// A protocol contract stand-in recording the adds; the receipt read answers a
// mined transaction whose one log is the _addDORequestEV of request 4349.
const protocolStub = (adds) => ({
  isNodeOperator: async () => true,
  getContract: () => ({
    _getOrdersCount: async () => 21n,
    _getOrder: async () => [WALLET, NODE, 4349n, 17n, 1n],
    _getDORequest: async () => [WALLET, 1n, 1n, 10n, 1n, 1n, 1n, 0n],
    _getMetadataCountForRequest: async () => 0n,
    removeAllListeners: async () => {},
    interface: { parseLog: () => ({ name: '_addDORequestEV', args: [WALLET, 4349n] }) }
  }),
  getProvider: () => ({ send: async () => ({ status: '0x1', blockNumber: '0x1', logs: [{ topics: [], data: '0x' }] }) }),
  addDORequest: async (...args) => { adds.push(['_addDORequest', ...args]); return { hash: '0xlegacy' }; },
  addDORequestV2: async (...args) => { adds.push(['addDORequestV2', ...args]); return { hash: '0xv2' }; }
});

test('the V2 ABI carries addDORequestV2 with the fourteen arguments of the PoX 2.0', () => {
  const iface = new ethers.Interface(protocolContractPolygon.abi);
  const fn = iface.getFunction('addDORequestV2');
  assert.equal(fn.inputs.map((i) => i.type).join(','), 'uint8,uint8,uint8,uint8,uint16,uint8,uint256,uint32,uint16,uint256,string,string,string,string');
  assert.equal(fn.inputs[7].name, 'maxGflops');
  assert.equal(fn.selector, ethers.id('addDORequestV2(uint8,uint8,uint8,uint8,uint16,uint8,uint256,uint32,uint16,uint256,string,string,string,string)').slice(0, 10));
  assert.deepEqual(fn.outputs.map((o) => o.type), ['uint256']);
  // The legacy entry point stays as it is.
  assert.equal(iface.getFunction('_addDORequest').inputs.length, 11);
});

test('v2TermsOf takes bigints, decimal strings and safe integers, and refuses a missing, fractional, negative or zero field', () => {
  const terms = v2TermsOf(TERMS);
  assert.deepEqual(terms, {
    maxPricePerCuHourWei: 300000000000000000n, maxGflops: 10n, relaysPerHour: 0n, gasLevel: 1000000000000000000n, escrowWei: TERMS.escrowWei
  });
  assert.deepEqual(Object.keys(terms), V2_TERM_FIELDS);
  assert.equal(v2TermsOf(undefined), null);
  assert.equal(v2TermsOf(null), null);
  assert.throws(() => v2TermsOf('terms'), TypeError);
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: undefined }), /options\.v2\.maxGflops must be an integer/);
  // Terms carrying the node limit as maxCu and no maxGflops lack the maxGflops term.
  const { maxGflops, ...withoutMaxGflops } = TERMS;
  assert.throws(() => v2TermsOf({ ...withoutMaxGflops, maxCu: maxGflops }), /options\.v2\.maxGflops must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, gasLevel: 1.5 }), /options\.v2\.gasLevel must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, gasLevel: '1.5e18' }), /options\.v2\.gasLevel must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, relaysPerHour: -1 }), /options\.v2\.relaysPerHour must not be negative/);
  assert.throws(() => v2TermsOf({ ...TERMS, maxPricePerCuHourWei: 0n }), /maxPricePerCuHourWei must be above 0/);
  assert.throws(() => v2TermsOf({ ...TERMS, escrowWei: '0' }), /escrowWei must be above 0/);
  // maxGflops 0 (any node) is a valid term; a decimal string may carry whitespace.
  assert.equal(v2TermsOf({ ...TERMS, maxGflops: 0 }).maxGflops, 0n);
  assert.equal(v2TermsOf({ ...TERMS, maxGflops: ' 10 ' }).maxGflops, 10n);
  // The empty string, a boolean and a hex string are not decimal integers
  // (BigInt would read them as 0, 1 and 16).
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: '' }), /options\.v2\.maxGflops must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: true }), /options\.v2\.maxGflops must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, relaysPerHour: true }), /options\.v2\.relaysPerHour must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: '0x10' }), /options\.v2\.maxGflops must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: '-1' }), /options\.v2\.maxGflops must be an integer/);
});

test('PolygonProtocolContract.addDORequestV2 sends the resources, one instance, the terms and the four metadata strings with the gas headroom', async () => {
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:1', ethers.Network.from(8995), { staticNetwork: true });
  const protocol = new PolygonProtocolContract(POX, { provider, signer: ethers.Wallet.createRandom().connect(provider) });
  const calls = [];
  const fn = async (...args) => { calls.push(['send', ...args]); return { hash: '0xv2' }; };
  fn.estimateGas = async (...args) => { calls.push(['estimate', ...args]); return 400000n; };
  protocol.protocolContract = { addDORequestV2: fn };
  try {
    const tx = await protocol.addDORequestV2('image', 'code', 'input', NODE, RESOURCES, v2TermsOf(TERMS));
    assert.equal(tx.hash, '0xv2');
    const args = [1, 1, 10, 1, 1, 1, 300000000000000000n, 10n, 0n, 1000000000000000000n, 'image', 'code', 'input', NODE];
    assert.deepEqual(calls[0], ['estimate', ...args, {}]);
    assert.deepEqual(calls[1], ['send', ...args, { gasLimit: 400000n + (400000n * BigInt(GAS_HEADROOM_PERCENT)) / 100n }]);
    // The legacy add is untouched: taskPrice as the uint8 maxPrice, validators as the instances.
    const legacy = async (...args) => { calls.push(['legacy', ...args]); return { hash: '0xl' }; };
    legacy.estimateGas = async () => 100000n;
    protocol.protocolContract = { _addDORequest: legacy };
    await protocol.addDORequest('image', 'code', 'input', NODE, RESOURCES);
    assert.deepEqual(calls[2].slice(0, 8), ['legacy', 1, 1, 10, 1, 1, 1, 3]);
  } finally {
    provider.destroy();
  }
});

test('selectRequestTerms keeps the V2 terms on a PoX apart from the token and refuses them where the PoX is the token proxy', async () => {
  const testnet = await runnerOn(TOKEN, 8995);
  testnet.selectRequestTerms(TERMS);
  assert.deepEqual(testnet.v2Terms, v2TermsOf(TERMS));
  testnet.selectRequestTerms(undefined);
  assert.equal(testnet.v2Terms, null);
  const mainnet = await runnerOn(MAINNET, 8995);
  assert.throws(() => mainnet.selectRequestTerms(TERMS), /takes no V2 request/);
  assert.equal(mainnet.v2Terms, null);
});

test('with V2 terms the balance is checked in wei against the escrow and the allowance raised to the exact escrow; without them against the legacy escrow', async () => {
  const runner = await runnerOn(TOKEN, 8995);
  const approvals = [];
  let balance = '0.05';
  runner.resources = RESOURCES;
  runner.tokenContract.getBalance = async () => balance;
  runner.tokenContract.checkAndSetAllowance = async (protocol, escrow) => { approvals.push([protocol, escrow]); return true; };

  runner.selectRequestTerms(TERMS);
  await runner.checkWalletBalance();
  await runner.checkAllowance();
  assert.deepEqual(approvals, [[POX, ESCROW_TOKENS]]);
  assert.equal(ethers.parseEther(ESCROW_TOKENS), TERMS.escrowWei);
  balance = '0.035';
  await assert.rejects(runner.checkWalletBalance(), /Insufficient wallet balance \(0\.035 tokens for an escrow of 0\.03510194904\)/);

  // A legacy request's escrow is taskPrice x validators x duration tokens.
  runner.selectRequestTerms(undefined);
  balance = '2.5';
  await assert.rejects(runner.checkWalletBalance(), /Insufficient wallet balance \(2\.5\/3\)/);
  balance = '3';
  await runner.checkWalletBalance();
  await runner.checkAllowance();
  assert.deepEqual(approvals[1], [POX, '3']);
  runner.resources = { ...RESOURCES, validators: 2, duration: 4 };
  balance = '23';
  await assert.rejects(runner.checkWalletBalance(), /Insufficient wallet balance \(23\/24\)/);
  balance = '24';
  await runner.checkWalletBalance();
  await runner.checkAllowance();
  assert.deepEqual(approvals[2], [POX, '24']);
});

test('createDORequest posts through addDORequestV2 with the terms and the pinned node when the run has V2 terms, through _addDORequest otherwise', async () => {
  const runner = await runnerOn(TOKEN, 8995);
  const adds = [];
  runner.protocolContract = protocolStub(adds);
  runner.resources = RESOURCES;
  runner.requestedNodeAddress = NODE;
  runner.selectRequestTerms(TERMS);
  await runner.createDORequest('image', 'code', 'input');
  assert.equal(runner.doRequest, 4349n);
  assert.equal(runner.doHash, '0xv2');
  assert.deepEqual(adds, [['addDORequestV2', 'image', 'code', 'input', NODE, RESOURCES, v2TermsOf(TERMS)]]);

  runner.selectRequestTerms(undefined);
  runner.requestedNodeAddress = '';
  await runner.createDORequest('image', 'code', 'input');
  assert.deepEqual(adds[1], ['_addDORequest', 'image', 'code', 'input', '', RESOURCES]);
  assert.equal(runner.doHash, '0xlegacy');
});

// A runner whose chain steps are stubbed around the request: the storage,
// the image registry, which answers, the web3 connection, the metadata, the
// order search, the processing wait and the result.
const stubbedRun = async (adds, approvals) => {
  const runner = await runnerOn(TOKEN, 8995);
  runner.protocolContract = protocolStub(adds);
  runner.tokenContract.getBalance = async () => '3.5';
  runner.tokenContract.checkAndSetAllowance = async (protocol, escrow) => { approvals.push([protocol, escrow]); return true; };
  runner.initializeDefaultStorage = () => {};
  runner.initializeImageRegistry = async () => true;
  runner.initializeWeb3Connection = async () => {};
  runner.getV3ImageMetadata = async () => 'image';
  runner.getV3CodeMetadata = async () => 'code';
  runner.getV3InputMedata = async () => (runner._sessionRequest ? 'v3s::input' : 'v3::input');
  runner.findOrder = async () => { runner.orderId = 2107; };
  runner.waitforTaskToBeProcessed = async () => true;
  runner.getOrderResult = async () => { runner.result = 'ok'; };
  return runner;
};

test('run() with options.v2 posts the V2 request pinned to the node, approves the escrow, and leaves no terms behind; a run without it is the legacy request', async () => {
  const adds = [];
  const approvals = [];
  const runner = await stubbedRun(adds, approvals);
  await runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('v2')", NODE, 'etny-nodenithy-testnet', { v2: TERMS });
  assert.equal(await runner.getResult(), 'ok');
  assert.deepEqual(adds, [['addDORequestV2', 'image', 'code', 'v3::input', NODE, RESOURCES, v2TermsOf(TERMS)]]);
  assert.deepEqual(approvals, [[POX, ESCROW_TOKENS]]);
  assert.equal(runner.v2Terms, null);

  await runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('legacy')", NODE, 'etny-nodenithy-testnet');
  assert.deepEqual(adds[1], ['_addDORequest', 'image', 'code', 'v3::input', NODE, RESOURCES]);
  assert.deepEqual(approvals[1], [POX, '3']);
});

// A stubbed processing wait whose first call fails as the node's fault
// (operatorFault) and whose later calls succeed; `attempts` counts the calls.
const operatorFaultOnce = (runner) => {
  const counter = { attempts: 0 };
  runner.waitforTaskToBeProcessed = async () => {
    counter.attempts += 1;
    if (counter.attempts === 1) {
      const err = new Error('Order timed out');
      err.operatorFault = true;
      throw err;
    }
    return true;
  };
  return counter;
};

test('a run approves the escrow again before resubmitting after an operator fault, with V2 terms and without', async () => {
  const adds = [];
  const approvals = [];
  const runner = await stubbedRun(adds, approvals);
  const v2 = operatorFaultOnce(runner);
  await runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('v2')", NODE, 'etny-nodenithy-testnet', { v2: TERMS, maxRetries: 2, retryDelayMs: 0 });
  assert.equal(await runner.getResult(), 'ok');
  assert.equal(v2.attempts, 2);
  assert.deepEqual(adds.map((add) => add[0]), ['addDORequestV2', 'addDORequestV2']);
  assert.deepEqual(adds[1].slice(1), ['image', 'code', 'v3::input', NODE, RESOURCES, v2TermsOf(TERMS)]);
  assert.deepEqual(approvals, [[POX, ESCROW_TOKENS], [POX, ESCROW_TOKENS]]);
  assert.equal(runner.v2Terms, null);

  // The first legacy request pulled the whole allowance, its escrow.
  const legacy = operatorFaultOnce(runner);
  await runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('legacy')", NODE, 'etny-nodenithy-testnet', { maxRetries: 2, retryDelayMs: 0 });
  assert.equal(legacy.attempts, 2);
  assert.deepEqual(adds.slice(2).map((add) => add[0]), ['_addDORequest', '_addDORequest']);
  assert.deepEqual(approvals.slice(2), [[POX, '3'], [POX, '3']]);
});

test('run() with invalid V2 terms fails before any chain call', async () => {
  const adds = [];
  const approvals = [];
  const runner = await stubbedRun(adds, approvals);
  await assert.rejects(
    runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('v2')", NODE, 'etny-nodenithy-testnet', { v2: { ...TERMS, escrowWei: undefined } }),
    /options\.v2\.escrowWei must be an integer/
  );
  assert.deepEqual(adds, []);
  assert.deepEqual(approvals, []);
  assert.equal(runner.v2Terms, null);
});

test('runSession() with options.v2 posts the v3s request through addDORequestV2 and returns the session handle', async () => {
  const adds = [];
  const approvals = [];
  const runner = await stubbedRun(adds, approvals);
  const session = await runner.runSession(RESOURCES, 'bbcas-e2e-js-20261024', 'ecld.onInput = sessionHandler', NODE, 'etny-nodenithy-testnet', { v2: TERMS });
  assert.equal(session.orderId, 2107);
  assert.equal(session.doReq, 4349);
  assert.equal(session.durationHours, 1);
  assert.deepEqual(adds, [['addDORequestV2', 'image', 'code', 'v3s::input', NODE, RESOURCES, v2TermsOf(TERMS)]]);
  assert.deepEqual(approvals, [[POX, ESCROW_TOKENS]]);
  assert.equal(runner.v2Terms, null);

  const legacy = await runner.runSession(RESOURCES, 'bbcas-e2e-js-20261024', 'ecld.onInput = sessionHandler', NODE, 'etny-nodenithy-testnet');
  assert.equal(legacy.orderId, 2107);
  assert.deepEqual(adds[1], ['_addDORequest', 'image', 'code', 'v3s::input', NODE, RESOURCES]);
  assert.deepEqual(approvals[1], [POX, '3']);
});
