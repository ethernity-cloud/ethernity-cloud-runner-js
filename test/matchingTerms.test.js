// The terms a runner adds a V2 request with, at pox-smart-contract-litvm
// 52e36e0 (MATCHING-SYNC-PLAN.md 4.5, RUN-03 to RUN-14), the same rules as
// runner-py's tests/test_matching_terms.py: the EPC figure in units of 64 MiB
// (OD23); the PoX's bounds tested before anything is sent (bid and bid
// ceiling 1 to 2^128 - 1, gasLevel 1e18 to 2^128 - 1, the required GFLOPS at
// most the ceiling) and one instance (OD25); a request with V2 terms while
// claims are off (OD26), with its minimum EPC and no score test (D196); the
// defaults (0, 0, 1e18) and a resource of 0; the score's rounding, half up on
// its decimal text; and the stored result read by its grammar on a network
// whose PoX names a PoxMatching, and as before elsewhere (OD11). No chain: the
// contracts are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { TermedRequest, claimsSettings, v2Settings } from '../claims.js';
import * as matching from '../matching.js';
import { requestTerms } from '../contract/operation/requestTerms.js';
import contractBloxberg from '../contract/abi/etnyAbi.js';

const IMAGE = 'QmMatchingImageA';
const V2 = { maxPricePerCuHourWei: 10n ** 18n, escrowWei: 3n * 10n ** 18n };
const RESOURCES = { cpu: 1, memory: 1, storage: 1, bandwidth: 1, duration: 1, validators: 1 };

// ------------------------------------------------------------- bounds

for (const [field, value, message] of [
  ['maxPricePerCuHourWei', 1n << 128n, /maxPricePerCuHourWei must be 1 to/],
  ['maxBidPerCuHourWei', 0n, /maxBidPerCuHourWei must be 1 to/],
  ['maxBidPerCuHourWei', 1n << 128n, /maxBidPerCuHourWei must be 1 to/],
  ['gasLevel', 10n ** 18n - 1n, /gasLevel must be 1000000000000000000 to/],
  ['gasLevel', 1n << 128n, /gasLevel must be 1000000000000000000 to/],
  ['requiredGflops', 401, /above its GFLOPS ceiling of 400/]
]) {
  test(`a term out of the PoX's bound is refused before anything is sent: ${field} ${value}`, () => {
    assert.throws(() => claimsSettings({ ...V2, maxGflops: 400, [field]: value }, {}, RESOURCES), message);
  });
}

test('a V2 request takes one instance', () => {
  assert.throws(() => claimsSettings(V2, {}, { ...RESOURCES, validators: 2 }), /takes one instance/);
  assert.equal(claimsSettings(V2, {}, { ...RESOURCES, validators: 0 }).terms.maxPricePerCuHourWei, 10n ** 18n);
});

test('the bounds themselves are taken', () => {
  const max = (1n << 128n) - 1n;
  const settings = claimsSettings({ ...V2, maxPricePerCuHourWei: max, maxBidPerCuHourWei: max, gasLevel: max, maxGflops: 400, requiredGflops: 400 }, {}, RESOURCES);
  assert.deepEqual([settings.terms.maxPricePerCuHourWei, settings.maxBidWei, settings.terms.gasLevel], [max, max, max]);
  assert.equal(claimsSettings({ ...V2, gasLevel: 10n ** 18n, requiredGflops: 60000 }, {}, RESOURCES).requiredGflops, 60000);
});

test('a raise past the bid ceiling is reported, not sent', () => {
  const quote = { counted: 5, canClaimNow: 0, minBidWei: 1n << 128n, baseNowWei: 0n, bidWei: 10n ** 18n, addedEscrowWei: 0n };
  const decision = matching.decideRaise({
    quote, claimersCounted: 0, approvableCounted: 0, claimedInRound: false, stepNow: 1, maxSteps: 8, round: 0, maxRounds: 5,
    ceilingWei: (1n << 128n) - 1n
  });
  assert.equal(decision.action, matching.REPORT);
  assert.match(decision.reason, /above the bid ceiling/);
});

// ------------------------------------------------------------- EPC figure

test('the EPC figure is rounded up to units of 64 MiB', () => {
  assert.deepEqual([0, 1, 64, 65, 128, 65535 * 64].map(matching.epcUnitsOfMib), [0, 1, 1, 2, 2, 65535]);
  assert.throws(() => matching.epcUnitsOfMib(65535 * 64 + 1), /at most 4194240 MiB/);
  assert.equal(matching.minimumEpc(0, 0), 1);
  assert.equal(matching.minimumEpc(3, 2), 3);
  assert.equal(matching.minimumEpc(1, 9), 9);
  assert.equal(claimsSettings({ ...V2, epcMiB: 200 }, {}, RESOURCES).epcUnits, 4);
  assert.throws(() => claimsSettings({ ...V2, epcMiB: 65535 * 64 + 1 }, {}, RESOURCES), /at most 4194240 MiB/);
});

// ------------------------------------------------------------- defaults (OD26) and rounding

test('the V2 defaults are 0, 0 and 1e18', () => {
  const settings = v2Settings({ maxPricePerCuHourWei: 1n, escrowWei: 2n }, {}, RESOURCES);
  assert.deepEqual([settings.terms.maxGflops, settings.requiredGflops, settings.terms.relaysPerHour, settings.terms.gasLevel, settings.epcUnits],
    [0n, 0, 0n, 10n ** 18n, 0]);
  assert.equal(v2Settings(undefined, {}, RESOURCES), null);
});

test('a resource of 0 takes its default', () => {
  assert.deepEqual(requestTerms({ cpu: 0, memory: null, storage: 0, duration: 3 }), {
    cpu: 1, memory: 1, storage: 40, bandwidth: 1, duration: 3, validators: 1, taskPrice: 10
  });
});

for (const [score, units] of [[0.5, 5000], ['0.5', 5000], [0.00005, 1], [0.00004, 0], [0.12345, 1235], ['0.12345', 1235],
  [1.00005, 10001], [5, 50000], ['4.99995', 50000], [1e-7, 0], ['2.5e-1', 2500], [0.00015, 2]]) {
  test(`the score is rounded half up on its decimal text: ${score}`, () => {
    assert.equal(matching.scoreUnits(score), units);
  });
}

for (const score of [5.00005, -0.00005, '', '0x1', '1_0', true, NaN, Infinity]) {
  test(`a score outside 0 to 5 or not a decimal is refused: ${String(score)}`, () => {
    assert.throws(() => matching.scoreUnits(score), /minimum node score/);
  });
}

// ------------------------------------------------------------- V2 terms, claims off

// The parts of EthernityCloudRunner a termed request uses, the network's
// MatchingContracts (`chain`, null for none) failing a case that reads a
// score or the image's records (D196).
const termedRunner = (balance = 10n * 10n ** 18n) => ({
  notices: [],
  allowances: [],
  resources: RESOURCES,
  matchingNotice(text) { this.notices.push(text); },
  async balanceWei() { return balance; },
  async allowWei(wei) { this.allowances.push(wei); }
});
const noScoreChain = (need) => ({
  reads: [],
  async imageEpcUnits(cid) {
    this.reads.push(cid);
    if (need instanceof Error) throw need;
    return need;
  },
  imageRecords: () => assert.fail('the image\'s records were read for a request not served by claims'),
  nodeStanding: () => assert.fail('a score was read for a request not served by claims'),
  minimumOn: () => assert.fail('minimumOn was read for a request not served by claims')
});

test('a termed request states its EPC minimum, approves its escrow and reads no score', async () => {
  const runner = termedRunner();
  const chain = noScoreChain(2);
  const termed = new TermedRequest(runner, '2.0', chain, v2Settings({ ...V2, epcMiB: 200 }, {}, RESOURCES));
  await termed.checkEscrow(IMAGE);
  assert.equal(termed.epcUnits, 4);
  assert.deepEqual(chain.reads, [IMAGE]);
  assert.deepEqual(runner.allowances, [3n * 10n ** 18n]);
});

test('a termed request without PoxMatching states one unit, and a "1.2" PoX none', async () => {
  let runner = termedRunner();
  let termed = new TermedRequest(runner, '2.0', null, v2Settings(V2, {}, RESOURCES));
  await termed.checkEscrow(IMAGE);
  assert.equal(termed.epcUnits, 1);
  runner = termedRunner();
  termed = new TermedRequest(runner, '1.2', null, v2Settings({ ...V2, epcMiB: 640 }, {}, RESOURCES));
  await termed.checkEscrow(IMAGE);
  assert.equal(termed.epcUnits, 0);
  assert.ok(runner.notices.some((n) => n.includes('epcMiB is not sent')));
});

test('a termed request whose registry does not answer is refused before the approval', async () => {
  const runner = termedRunner();
  const termed = new TermedRequest(runner, '2.0', noScoreChain(Object.assign(new Error('request timeout'), { code: 'TIMEOUT' })),
    v2Settings(V2, {}, RESOURCES));
  await assert.rejects(() => termed.checkEscrow(IMAGE), /did not answer the EPC need/);
  assert.deepEqual(runner.allowances, []);
});

test('a termed request\'s balance is checked in wei', async () => {
  await assert.rejects(() => new TermedRequest(termedRunner(), '2.0', null, v2Settings({ ...V2, escrowWei: 11n * 10n ** 18n }, {}, RESOURCES)).checkBalance(),
    /Insufficient wallet balance/);
  await new TermedRequest(termedRunner(), '2.0', null, v2Settings({ ...V2, escrowWei: 10n * 10n ** 18n }, {}, RESOURCES)).checkBalance();
});

// ------------------------------------------------------------- receipts and the read interval (RUN-13)

test('a send of the claims path or a V2 request is waited for with the runner\'s receipt poll, a status other than 1 thrown', async () => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.claimsPollMs = 0;
  const asked = [];
  let answer = { status: '0x1', blockNumber: '0x5', logs: [] };
  runner.protocolContract = { getProvider: () => ({ send: async (method, params) => { asked.push([method, ...params]); return answer; } }) };
  const receipt = await runner.receiptOf({ hash: '0xabc', wait: () => assert.fail('ethers\' wait was used') });
  assert.deepEqual([receipt.status, receipt.blockNumber], [1, 5]);
  assert.deepEqual(asked, [['eth_getTransactionReceipt', '0xabc']]);
  answer = { status: '0x0', blockNumber: '0x6', logs: [] };
  await assert.rejects(() => runner.receiptOf({ hash: '0xdef' }), /transaction 0xdef reverted/);
});

test('a request served by claims is read once a block, at the descriptor\'s blockSeconds', async () => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.networkConfig = { blockSeconds: 5 };
  assert.equal(runner.claimsReadMs(), 5000);
  runner.networkConfig = { blockSeconds: 2 };
  assert.equal(runner.claimsReadMs(), 2000);
  runner.claimsPollMs = 0;
  assert.equal(runner.claimsReadMs(), 0);
});

// ------------------------------------------------------------- the stored result (OD11)

const ORDER_ID = 1234;
const POX = '0x549A6E06BB2084100148D50F51CF77a3436C3Ae7';
const MATCHING = `0x${'01'.repeat(20)}`;
const wallet = ethers.Wallet.createRandom();

// A LOCAL runner whose order ORDER_ID's stored result is `stored`, on a PoX
// that names a PoxMatching or not, its other reads answered for the result's
// transaction.
const resultRunner = (stored, matchingAddress) => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.dispatchECEvent = () => {};
  runner.protocolAbi = contractBloxberg.abi;
  runner.orderId = ORDER_ID;
  runner.challengeHash = 'the challenge';
  runner.resultDeadline = Date.now() + 60000;
  runner.generation = { version: '2.0', matchingAddress };
  runner.protocolContract = {
    getResultFromOrder: async () => stored,
    getContract: () => ({ target: POX }),
    getProvider: () => ({ getNetwork: async () => ({ chainId: 8995n }) })
  };
  return runner;
};

// The stored result of a transaction the trustedzone signs, legacy (type 0)
// and EIP-155 as both trustedzones write it unless `type` names another, its
// hex with "0x" when `prefixed`.
const signedStored = async (prefixed, type = 0) => {
  const iface = new ethers.Interface(contractBloxberg.abi);
  const tx = await wallet.signTransaction({
    type, to: POX, chainId: 8995, nonce: 0, gasLimit: 1000000, gasPrice: 1000000,
    data: iface.encodeFunctionData('_addResultToOrder', [ORDER_ID, `v6:0:${'ab'.repeat(32)}:challenge`])
  });
  return `v3:${prefixed ? tx : tx.slice(2)}:QmResult`;
};

test('on a network without PoxMatching the stored result is read as before', async () => {
  for (const stored of [await signedStored(true), await signedStored(false), await signedStored(true, 1)]) {
    const read = await resultRunner(stored, ethers.ZeroAddress).getResultFromOrder();
    assert.equal(read.message, 'Integrity check failed, signer wallet address is wrong.');
  }
});

test('on a network with PoxMatching only a stored result decoded for the order is taken', async () => {
  let read = await resultRunner(await signedStored(true), MATCHING).getResultFromOrder();
  assert.equal(read.message, 'Integrity check failed, signer wallet address is wrong.');
  for (const stored of [await signedStored(false), await signedStored(true, 1)]) {
    read = await resultRunner(stored, MATCHING).getResultFromOrder();
    assert.equal(read.operatorFault, true);
    assert.match(read.message, /outside the grammar of spec\/matching\.md 17 \(noTransaction\)/);
  }
});
