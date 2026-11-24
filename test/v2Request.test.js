// A run with options.v2 (run() and runSession()) on a network whose requests
// are not served by claims posts its DO request through addDORequestV2 in the
// form the PoX's VERSION() names ("2.0": maxGflops uint48 with the minimum EPC
// in bits 32 to 47; "1.2": uint32), with the terms given and their defaults
// (OD26: maxGflops 0, relaysPerHour 0, gasLevel 1e18), checks the wallet's
// balance in wei against the escrow and raises the token allowance to that
// exact escrow, once the path is chosen (RUN-09, RUN-11); V2 terms without an
// escrowWei, and a run without them, are the legacy request (the balance and
// the allowance checked against taskPrice x validators x duration, the escrow
// _addDORequest takes). A PoX that takes no V2 add refuses V2 terms with an
// escrow before anything is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner, { V2_TERM_FIELDS, v2TermsOf } from '../runner.js';
import { TermedRequest } from '../claims.js';
import { ECAddress } from '../enums.js';
import { NO_GENERATION, V2_ADD_ABI, readGeneration, sendV2Add } from '../contract/operation/matchingContract.js';
import protocolContractPolygon from '../contract/abi/polygonProtocolAbi.js';
import * as matchingAbi from '../contract/abi/matchingAbi.js';
import { GAS_HEADROOM_PERCENT, callRefused } from '../utils.js';

const TOKEN = ECAddress.BLOXBERG.TESTNET_ADDRESS;
const POX = ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS;
const NODE = '0xB78804B94a49579e8c4e1A98e9e965BF3D15062F';
const WALLET = '0xF79648481c486406F0872401bDCfdA2d6152a6E1';
const PRICING = `0x${'0c'.repeat(20)}`;
const MATCHING = `0x${'01'.repeat(20)}`;

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

// A runner of the wallet WALLET on the network of `address`, its PoX of
// generation `generation`; the balance check resolves the wallet's address
// from the signer before its read.
const runnerOn = async (address, chainId, generation = { version: '2.0', matchingAddress: ethers.ZeroAddress }) => {
  const runner = new EthernityCloudRunner(address, { provider: providerOn(chainId), signer: { getAddress: async () => WALLET } });
  runner.dispatchECEvent = () => {};
  await runner.resolveNetworkContext();
  runner.readPoxGeneration = async () => generation;
  return runner;
};

// A protocol contract stand-in recording the adds; the receipt read answers a
// mined transaction whose one log is the _addDORequestEV of request 4349.
const protocolStub = (adds) => ({
  isNodeOperator: async () => true,
  getSigner: () => 'the signer',
  getContract: () => ({
    _getOrdersCount: async () => 21n,
    _getOrder: async () => [WALLET, NODE, 4349n, 17n, 1n],
    _getDORequest: async () => [WALLET, 1n, 1n, 10n, 1n, 1n, 1n, 0n],
    _getMetadataCountForRequest: async () => 0n,
    removeAllListeners: async () => {},
    interface: { parseLog: () => ({ name: '_addDORequestEV', args: [WALLET, 4349n] }) }
  }),
  getProvider: () => ({ send: async () => ({ status: '0x1', blockNumber: '0x1', logs: [{ topics: [], data: '0x' }] }) }),
  addDORequest: async (...args) => { adds.push(['_addDORequest', ...args]); return { hash: '0xlegacy' }; }
});

// The runner's termed requests send through `adds` instead of the chain.
const recordTermedAdds = (runner, adds) => {
  const choose = runner.termedRequest.bind(runner);
  runner.termedRequest = () => {
    const termed = choose();
    if (termed) {
      termed.addRequest = async (metadata) => {
        adds.push(['addDORequestV2', termed.version, ...metadata, termed.epcUnits]);
        return { hash: '0xv2' };
      };
    }
    return termed;
  };
};

test('the V2 add takes the form its VERSION() names, and the protocol ABI carries no V2 add of its own', () => {
  const v20 = new ethers.Interface(V2_ADD_ABI['2.0']).getFunction('addDORequestV2');
  const v12 = new ethers.Interface(V2_ADD_ABI['1.2']).getFunction('addDORequestV2');
  assert.equal(v20.inputs[7].type, 'uint48');
  assert.equal(v12.inputs[7].type, 'uint32');
  assert.equal(v20.selector, '0x9f74fcce');
  assert.equal(v12.selector, '0x9fdaa26e');
  assert.equal(V2_ADD_ABI['2.0'], matchingAbi.pox);
  assert.equal(new ethers.Interface(protocolContractPolygon.abi).getFunction('addDORequestV2'), null);
  assert.equal(new ethers.Interface(protocolContractPolygon.abi).getFunction('_addDORequest').inputs.length, 11);
});

test('v2TermsOf takes bigints, decimal strings and safe integers, defaults the fields left out and refuses a missing bid, a fractional, negative or zero field', () => {
  const terms = v2TermsOf(TERMS);
  assert.deepEqual(terms, {
    maxPricePerCuHourWei: 300000000000000000n, maxGflops: 10n, relaysPerHour: 0n, gasLevel: 1000000000000000000n, escrowWei: TERMS.escrowWei
  });
  assert.deepEqual(Object.keys(terms), V2_TERM_FIELDS);
  assert.equal(v2TermsOf(undefined), null);
  assert.equal(v2TermsOf(null), null);
  assert.throws(() => v2TermsOf('terms'), TypeError);
  assert.deepEqual(v2TermsOf({ maxPricePerCuHourWei: 1 }), {
    maxPricePerCuHourWei: 1n, maxGflops: 0n, relaysPerHour: 0n, gasLevel: 10n ** 18n, escrowWei: null
  });
  assert.throws(() => v2TermsOf({ ...TERMS, maxPricePerCuHourWei: undefined }), /options\.v2\.maxPricePerCuHourWei must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, gasLevel: 1.5 }), /options\.v2\.gasLevel must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, gasLevel: '1.5e18' }), /options\.v2\.gasLevel must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, relaysPerHour: -1 }), /options\.v2\.relaysPerHour must not be negative/);
  assert.throws(() => v2TermsOf({ ...TERMS, maxPricePerCuHourWei: 0n }), /maxPricePerCuHourWei must be above 0/);
  assert.throws(() => v2TermsOf({ ...TERMS, escrowWei: '0' }), /escrowWei must be above 0/);
  assert.equal(v2TermsOf({ ...TERMS, maxGflops: ' 10 ' }).maxGflops, 10n);
  // The empty string, a boolean and a hex string are not decimal integers
  // (BigInt would read them as 0, 1 and 16).
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: '' }), /options\.v2\.maxGflops must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: true }), /options\.v2\.maxGflops must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, relaysPerHour: true }), /options\.v2\.relaysPerHour must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: '0x10' }), /options\.v2\.maxGflops must be an integer/);
  assert.throws(() => v2TermsOf({ ...TERMS, maxGflops: '-1' }), /options\.v2\.maxGflops must be an integer/);
});

// A signer stand-in that answers a call with request id 5 and records the
// estimate and the send.
const signerOf = (calls) => ({
  getAddress: async () => WALLET,
  call: async (tx) => { calls.push(['call', tx.data.slice(0, 10)]); return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [5]); },
  estimateGas: async (tx) => { calls.push(['estimate', tx.data.slice(0, 10)]); return 400000n; },
  sendTransaction: async (tx) => { calls.push(['send', tx.data, tx.gasLimit]); return { hash: '0xv2' }; }
});

for (const [version, selector, word] of [['2.0', '0x9f74fcce', (3n << 32n) | (250n << 16n) | 400n], ['1.2', '0x9fdaa26e', (250n << 16n) | 400n]]) {
  test(`sendV2Add makes a "${version}" add as a call first and sends it with the gas headroom`, async () => {
    const calls = [];
    const tx = await sendV2Add(POX, signerOf(calls), version, { cpu: 1, memory: 2, storage: 3, bandwidth: 4, duration: 5 },
      7n, (3n << 32n) | (250n << 16n) | 400n, 2n, 10n ** 18n, ['m1', 'm2', 'm3', '']);
    assert.equal(tx.hash, '0xv2');
    assert.deepEqual(calls.map((c) => c[0]), ['call', 'estimate', 'send']);
    assert.equal(calls[0][1], selector);
    const sent = new ethers.Interface(V2_ADD_ABI[version]).decodeFunctionData('addDORequestV2', calls[2][1]);
    assert.deepEqual([...sent].map(String), ['1', '2', '3', '4', '5', '1', '7', String(word), '2', String(10n ** 18n), 'm1', 'm2', 'm3', '']);
    assert.equal(calls[2][2], 400000n + (400000n * BigInt(GAS_HEADROOM_PERCENT)) / 100n);
  });
}

// A provider stand-in whose contracts answer from `answers` by address and
// selector, a thrown error or a value encoded as the function's output.
const providerAnswering = (answers) => {
  const reads = [];
  const iface = new ethers.Interface([...matchingAbi.pox, ...matchingAbi.pricing]);
  return {
    reads,
    call: async (tx) => {
      const fragment = iface.getFunction(tx.data.slice(0, 10));
      reads.push(fragment.name);
      const answer = answers[tx.to.toLowerCase()][fragment.name];
      if (answer instanceof Error) throw answer;
      return iface.encodeFunctionResult(fragment, [answer]);
    }
  };
};
const revert = () => Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION', info: { error: { code: 3, message: 'execution reverted' } } });
const unanswered = () => Object.assign(new Error('request timeout'), { code: 'TIMEOUT' });

test('the generation is read from the PoX and its pricing', async () => {
  const provider = providerAnswering({ [POX.toLowerCase()]: { VERSION: '2.0', pricingAddress: PRICING }, [PRICING]: { matching: MATCHING } });
  assert.deepEqual(await readGeneration(POX, provider), { version: '2.0', matchingAddress: ethers.getAddress(MATCHING) });
  assert.deepEqual(provider.reads, ['VERSION', 'pricingAddress', 'matching']);
  const v12 = providerAnswering({ [POX.toLowerCase()]: { VERSION: '1.2', pricingAddress: PRICING }, [PRICING]: { matching: revert() } });
  assert.deepEqual(await readGeneration(POX, v12), { version: '1.2', matchingAddress: ethers.ZeroAddress });
  for (const answer of ['1.1', revert()]) {
    const older = providerAnswering({ [POX.toLowerCase()]: { VERSION: answer } });
    assert.deepEqual(await readGeneration(POX, older), { version: answer instanceof Error ? null : answer, matchingAddress: ethers.ZeroAddress });
    assert.deepEqual(older.reads, ['VERSION']);
  }
  await assert.rejects(readGeneration(POX, providerAnswering({ [POX.toLowerCase()]: { VERSION: unanswered() } })), /request timeout/);
  await assert.rejects(readGeneration(POX, providerAnswering({
    [POX.toLowerCase()]: { VERSION: '2.0', pricingAddress: PRICING }, [PRICING]: { matching: unanswered() }
  })), /request timeout/);
});

test('a refusal is told from a read the RPC did not answer', () => {
  assert.ok(callRefused(revert()));
  assert.ok(callRefused({ code: 'CALL_EXCEPTION', info: { error: { code: -32015, message: 'VM execution error.', data: 'Reverted 0x' } } }));
  assert.ok(callRefused({ code: 'CALL_EXCEPTION' }));
  assert.ok(callRefused({ code: 'BAD_DATA' }));
  assert.ok(!callRefused({ code: 'CALL_EXCEPTION', info: { error: { code: -32005, message: 'limit exceeded' } } }));
  assert.ok(!callRefused({ code: 'CALL_EXCEPTION', info: { error: { message: 'Failed to fetch' } } }));
  assert.ok(!callRefused(unanswered()));
});

test('V2 terms with an escrow are added with terms in the form of a "2.0" or "1.2" PoX and refused on one that takes no V2 add', async () => {
  for (const version of ['2.0', '1.2']) {
    const runner = await runnerOn(TOKEN, 8995);
    runner.resources = RESOURCES;
    runner.selectRequestTerms(TERMS);
    runner.generation = { version, matchingAddress: ethers.ZeroAddress };
    const termed = runner.termedRequest();
    assert.ok(termed instanceof TermedRequest);
    assert.equal(termed.version, version);
  }
  for (const generation of [NO_GENERATION, { version: '1.1', matchingAddress: ethers.ZeroAddress }]) {
    const runner = await runnerOn(TOKEN, 8995);
    runner.resources = RESOURCES;
    runner.selectRequestTerms(TERMS);
    runner.generation = generation;
    assert.throws(() => runner.termedRequest(), /takes no addDORequestV2/);
  }
});

test('a V2 add takes one instance', async () => {
  const runner = await runnerOn(TOKEN, 8995);
  runner.resources = { ...RESOURCES, validators: 2 };
  assert.throws(() => runner.selectRequestTerms(TERMS), /takes one instance/);
  runner.resources = { ...RESOURCES, validators: 0 };
  runner.selectRequestTerms(TERMS);
  assert.equal(runner.v2Terms.maxGflops, 10n);
});

test('with V2 terms the balance is checked in wei against the escrow and the allowance raised to the exact escrow; without them against the legacy escrow', async () => {
  const runner = await runnerOn(TOKEN, 8995);
  const approvals = [];
  let balance = '0.05';
  runner.resources = RESOURCES;
  runner.tokenContract.getBalance = async () => balance;
  runner.tokenContract.checkAndSetAllowance = async (protocol, escrow) => { approvals.push([protocol, escrow]); return true; };

  runner.selectRequestTerms(TERMS);
  await runner.prepareRequest();
  assert.ok(runner.termed instanceof TermedRequest);
  await runner.checkWalletBalance();
  await runner.checkAllowance();
  assert.deepEqual(approvals, [[POX, ESCROW_TOKENS]]);
  assert.equal(ethers.parseEther(ESCROW_TOKENS), TERMS.escrowWei);
  balance = '0.035';
  await assert.rejects(runner.checkWalletBalance(), /Insufficient wallet balance: the request's escrow is 35101949040000000 wei and the wallet holds 35000000000000000/);

  // A legacy request's escrow is taskPrice x validators x duration tokens.
  runner.selectRequestTerms(undefined);
  await runner.prepareRequest();
  assert.equal(runner.termed, null);
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

test('createDORequest posts through the termed request with the pinned node when the run has V2 terms with an escrow, through _addDORequest otherwise', async () => {
  const runner = await runnerOn(TOKEN, 8995);
  const adds = [];
  runner.protocolContract = protocolStub(adds);
  recordTermedAdds(runner, adds);
  runner.resources = RESOURCES;
  runner.requestedNodeAddress = NODE;
  runner.selectRequestTerms(TERMS);
  runner.generation = { version: '2.0', matchingAddress: ethers.ZeroAddress };
  runner.termed = runner.termedRequest();
  await runner.createDORequest('image', 'code', 'input');
  assert.equal(runner.doRequest, 4349n);
  assert.equal(runner.doHash, '0xv2');
  assert.deepEqual(adds, [['addDORequestV2', '2.0', 'image', 'code', 'input', NODE, 0]]);

  runner.selectRequestTerms(undefined);
  runner.termed = null;
  runner.requestedNodeAddress = '';
  await runner.createDORequest('image', 'code', 'input');
  assert.deepEqual(adds[1], ['_addDORequest', 'image', 'code', 'input', '', RESOURCES]);
  assert.equal(runner.doHash, '0xlegacy');
});

// A runner whose chain steps are stubbed around the request: the storage,
// the image registry, the web3 connection, the metadata, the order search,
// the processing wait and the result.
const stubbedRun = async (adds, approvals, generation) => {
  const runner = await runnerOn(TOKEN, 8995, generation);
  runner.protocolContract = protocolStub(adds);
  recordTermedAdds(runner, adds);
  runner.tokenContract.getBalance = async () => '3.5';
  runner.tokenContract.checkAndSetAllowance = async (protocol, escrow) => { approvals.push([protocol, escrow]); return true; };
  runner.initializeDefaultStorage = () => {};
  runner.initializeImageRegistry = async () => {};
  runner.initializeWeb3Connection = async () => {};
  runner.getV3ImageMetadata = async () => 'image';
  runner.getV3CodeMetadata = async () => 'code';
  runner.getV3InputMedata = async () => (runner._sessionRequest ? 'v3s::input' : 'v3::input');
  runner.findOrder = async () => { runner.orderId = 2107; };
  runner.waitforTaskToBeProcessed = async () => true;
  runner.getOrderResult = async () => { runner.result = 'ok'; };
  return runner;
};

test('run() with options.v2 posts the V2 request pinned to the node in its PoX\'s form, approves the escrow, and leaves no terms behind; a run without it is the legacy request', async () => {
  const adds = [];
  const approvals = [];
  const runner = await stubbedRun(adds, approvals);
  await runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('v2')", NODE, 'etny-nodenithy-testnet', { v2: { ...TERMS, epcMiB: 100 } });
  assert.equal(await runner.getResult(), 'ok');
  assert.deepEqual(adds, [['addDORequestV2', '2.0', 'image', 'code', 'v3::input', NODE, 2]]);
  assert.deepEqual(approvals, [[POX, ESCROW_TOKENS]]);
  assert.equal(runner.v2Terms, null);
  assert.equal(runner.termed, null);

  await runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('legacy')", NODE, 'etny-nodenithy-testnet');
  assert.deepEqual(adds[1], ['_addDORequest', 'image', 'code', 'v3::input', NODE, RESOURCES]);
  assert.deepEqual(approvals[1], [POX, '3']);
});

test('run() on a "1.2" PoX posts the uint32 form, which states no minimum EPC', async () => {
  const adds = [];
  const approvals = [];
  const runner = await stubbedRun(adds, approvals, { version: '1.2', matchingAddress: ethers.ZeroAddress });
  await runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('v2')", NODE, 'etny-nodenithy-testnet', { v2: { ...TERMS, epcMiB: 100 } });
  assert.deepEqual(adds, [['addDORequestV2', '1.2', 'image', 'code', 'v3::input', NODE, 0]]);
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
  assert.deepEqual(adds[1].slice(1), ['2.0', 'image', 'code', 'v3::input', NODE, 1]);
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
    runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('v2')", NODE, 'etny-nodenithy-testnet', { v2: { ...TERMS, maxPricePerCuHourWei: undefined } }),
    /options\.v2\.maxPricePerCuHourWei must be an integer/
  );
  await assert.rejects(
    runner.run(RESOURCES, 'bbcas-e2e-js-20261024', "hello('v2')", NODE, 'etny-nodenithy-testnet', { v2: { ...TERMS, gasLevel: 10n ** 18n - 1n } }),
    /options\.v2\.gasLevel must be 1000000000000000000 to/
  );
  assert.deepEqual(adds, []);
  assert.deepEqual(approvals, []);
  assert.equal(runner.v2Terms, null);
});

test('runSession() with options.v2 posts the v3s request through the V2 add and returns the session handle', async () => {
  const adds = [];
  const approvals = [];
  const runner = await stubbedRun(adds, approvals);
  const session = await runner.runSession(RESOURCES, 'bbcas-e2e-js-20261024', 'ecld.onInput = sessionHandler', NODE, 'etny-nodenithy-testnet', { v2: TERMS });
  assert.equal(session.orderId, 2107);
  assert.equal(session.doReq, 4349);
  assert.equal(session.durationHours, 1);
  assert.deepEqual(adds, [['addDORequestV2', '2.0', 'image', 'code', 'v3s::input', NODE, 1]]);
  assert.deepEqual(approvals, [[POX, ESCROW_TOKENS]]);
  assert.equal(runner.v2Terms, null);

  const legacy = await runner.runSession(RESOURCES, 'bbcas-e2e-js-20261024', 'ecld.onInput = sessionHandler', NODE, 'etny-nodenithy-testnet');
  assert.equal(legacy.orderId, 2107);
  assert.deepEqual(adds[1], ['_addDORequest', 'image', 'code', 'v3s::input', NODE, RESOURCES]);
  assert.deepEqual(approvals[1], [POX, '3']);
});
