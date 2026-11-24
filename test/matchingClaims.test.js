// A request served by claims (claims.ClaimsPath; MATCHING-DESIGN.md section
// 8): the approval of a claim at the read of each block on the parameter set
// requestInfo names, the raise within the bid ceiling over the nodes at or
// above the minimum, the nodes the runner passes over (a mandated node
// canClaimOf says cannot claim, its local list, a paid class's recent counted
// failures), the order that does not start (expireUnstarted) and the one that
// expires (expireOrder, noteRefund), the report of an end by class, a 33
// before its time among them (early33), and the noteAmbiguous sent an hour
// after the result, and the checks before the add (a pinned node's ban, the
// image's health, its records in ECImageRegistryV4 and the dApp's minimum
// operator score, the quote, the escrow escrowFor answers).
//
// The chain is a stand-in for MatchingContracts that answers from Example 1 of
// 3.8 (matching-rank.json `example-1`, bid 1.2 ECLD per CU-hour; its rounds
// open in block 1000, one-block steps after one lead block): its list words,
// and claims mined at the blocks a test names, visible from those blocks on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import * as matching from '../matching.js';
import { ClaimsPath, claimsSettings, hintWords, pinnedBan, settlePending } from '../claims.js';
import MatchingContracts from '../contract/operation/matchingContract.js';
import * as matchingAbi from '../contract/abi/matchingAbi.js';

const RANK = JSON.parse(readFileSync(new URL('./fixtures/matching-rank.json', import.meta.url), 'utf8'));
const CASE = RANK.ranking.find((c) => c.name === 'example-1');
const LABELS = Object.fromEntries(Object.entries(RANK.labels).map(([node, label]) => [label, node]));
const [N1, N2, , , N5] = ['N1', 'N2', 'N3', 'N4', 'N5'].map((l) => LABELS[l]);
const N3 = LABELS.N3;
const PARAMS = CASE.parameterSets[0];
const STAMP_0 = `0x${'10'.repeat(32)}`;
const STAMP_1 = `0x${'11'.repeat(32)}`;
const NOW = 1795008240;
const SLOT = 43200;
const IMAGE = 'QmMatchingImageA';
const TEMPLATE = 'ecld-nodenithy-matching';
const QUOTE_DEFAULT = {
  counted: 5, canClaimNow: 0, minBidWei: 7n * 10n ** 17n, baseNowWei: 6n * 10n ** 17n, bidWei: 65n * 10n ** 16n,
  addedEscrowWei: 10n ** 17n
};
const DP = Object.fromEntries(CASE.expected.list.map((e) => [e.node, BigInt(e.dpRequestId)]));
const LISTED = [...CASE.expected.list].sort((a, b) => (b.band - a.band) || (a.rollIndex - b.rollIndex));
const BASE = BigInt(CASE.expected.baseWei);

const claimWord = (dp, block) => dp | (BigInt(block) << 48n) | (BigInt(NOW) << 96n) | ((1n << 8n) << 128n);
const mined = (value) => ({ hash: '0x', wait: async () => value });

class FakeChain {
  constructor(runner, {
    block = 1001, lastBlock = 1030, claims = [], quote = QUOTE_DEFAULT, minimumOn = false, tier = 0, scores = {},
    lastFailures = {}, health = new Array(20).fill(0n), startedAt = 0, approvedAt = NOW - 1000
  } = {}) {
    Object.assign(this, { runner, block: block - 1, lastBlock, claimsList: claims, quote: { ...quote }, minimumOnValue: minimumOn, tier, scores, lastFailures, health, startedAt, approvedAt });
    this.stamp = STAMP_0;
    this.round = 0;
    this.roundBlock = 1000;
    this.sent = [];
    this.quoteMinimums = [];
    this.refuse = new Set();
    this.time = NOW;
    this.marked = false;
    this.parameterIndex = 0;
    this.parameterReads = [];
    this.cannotClaim = new Set();
    this.canClaimReads = [];
    this.early = false;
    this.earlyReads = [];
    this.escrow = { escrowWei: 2n * 10n ** 18n, workWei: 16n * 10n ** 17n, chainFeeWei: 10n ** 16n, escrowGflops: 400, trustedZoneFee: 10, secureLockFee: 5 };
    this.escrowReads = [];
    this.listReads = 0;
    this.claimsOnSet = true;
    this.createdAt = NOW - 60;
    this.status = matching.REQUEST_AVAILABLE;
    this.epcNeed = 0;
    this.epcReads = [];
  }

  visible() { return this.claimsList.filter(([, b]) => b <= this.block); }

  async requestInfo() {
    this.block += 1;
    if (this.block > this.lastBlock) this.runner.inFlight = false;
    return {
      settled: true, claims: this.claimsOnSet, createdAt: this.createdAt,
      ranked: true, round: this.round, roundStamp: this.stamp, seed: CASE.expected.seed,
      roundBlock: this.roundBlock,
      closedStep: Math.max(0, matching.stepAt(this.block + 1, this.roundBlock, PARAMS.stepBlocks, PARAMS.leadBlocks) - 1),
      stepNow: matching.stepAt(this.block, this.roundBlock, PARAMS.stepBlocks, PARAMS.leadBlocks),
      claimCount: this.visible().length, claimedInRound: this.visible().length > 0, parameterSet: this.parameterIndex
    };
  }

  async parameterSet(index) {
    this.parameterReads.push(index);
    return { ...PARAMS };
  }

  async requestStatus() { return this.status; }

  async imageEpcUnits(imageCid) {
    this.epcReads.push(imageCid);
    if (this.epcNeed instanceof Error) throw this.epcNeed;
    return this.epcNeed;
  }

  async candidatePages() {
    this.listReads += 1;
    const places = LISTED.map((e) => matching.placeOf(e.band, e.rollIndex));
    const entries = LISTED.map((e, i) => matching.decodeEligible(BigInt(e.word), BigInt(e.priceWei) - BASE, places[i]));
    const [h, found] = matching.listHashOf(entries, PARAMS.maxSteps);
    return [{
      roundStamp: this.stamp, eligible: LISTED.map((e) => BigInt(e.word)), tips: LISTED.map((e) => BigInt(e.priceWei) - BASE),
      places, hOut: h, matchFoundOut: found, nextBand: 0, nextFrom: 0n, done: true, settled: true
    }];
  }

  async claimers(doRequestId, count) {
    return this.visible().slice(0, count).map(([node, block, approvable]) => [node, claimWord(DP[node] ?? 999n, block), approvable]);
  }

  async canClaimOf(doRequestId, nodes) {
    this.canClaimReads.push([...nodes]);
    return { roundStamp: this.stamp, canClaim: nodes.map((n) => !this.cannotClaim.has(n)) };
  }

  async escrowFor(...args) {
    this.escrowReads.push(args);
    return { ...this.escrow };
  }

  async early33(orderId) {
    this.earlyReads.push(orderId);
    return this.early;
  }

  async chainTime() { return this.time; }

  async slotSeconds() { return SLOT; }

  async nodeStanding(node) { return { score: this.scores[node] ?? matching.SCORE_MAX, beatAgeSlots: 0, bannedUntil: 0 }; }

  async lastFailureSlot(node) { return this.lastFailures[node] ?? 0; }

  async minimumOn() { return this.minimumOnValue; }

  async tierScore() { return this.tier; }

  async healthWords() { return this.health; }

  async bidQuotePages(doRequestId, minScore) {
    this.quoteMinimums.push(minScore);
    return [{ ...this.quote, roundStamp: this.stamp, done: true }];
  }

  send(name, ...args) {
    if (this.refuse.has(name)) return Promise.reject(new Error(`execution reverted: ${name}`));
    this.sent.push([name, ...args]);
    return Promise.resolve(mined({ status: 1, logs: [] }));
  }

  placeOrder(doRequestId, dp) { return this.send('placeOrder', doRequestId, dp); }

  placedOrder() { return 77; }

  async increaseBid(doRequestId, bid) {
    const tx = await this.send('increaseBid', doRequestId, bid);
    [this.stamp, this.round, this.roundBlock] = [STAMP_1, 1, this.block];
    return tx;
  }

  expireUnstarted(orderId) { return this.send('expireUnstarted', orderId); }

  expireOrder(orderId) { return this.send('expireOrder', orderId); }

  noteRefund(orderId) { return this.send('noteRefund', orderId); }

  noteAmbiguous(orderId, hints) { return this.send('noteAmbiguous', orderId, hints); }

  async orderStartedAt() { return this.startedAt; }

  async orderApprovedAt() { return this.approvedAt; }

  async orderResultAt() { return NOW; }

  async orderMarked() { return this.marked; }
}

class Runner {
  constructor(orders = {}) {
    this.inFlight = true;
    this.claimsPollMs = 0;
    this.matchingNotices = [];
    this.matchingPending = [];
    this.localList = new matching.LocalList();
    this.resources = { cpu: 4, memory: 8, storage: 40, bandwidth: 10, duration: 1 };
    this.allowances = [];
    this.balance = 10n * 10n ** 18n;
    this.doRequest = '301';
    this.protocolContract = { getOrder: async (id) => orders[id] };
  }

  async balanceWei() { return this.balance; }

  claimsRunning() { return this.inFlight; }

  claimsReadMs() { return this.claimsPollMs; }

  // runner.receiptOf: the mined receipt, a status other than 1 thrown.
  async receiptOf(tx) {
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`transaction ${tx.hash} reverted`);
    return receipt;
  }

  matchingNotice(text) { this.matchingNotices.push(text); }

  logAppend() {}

  resolveTrustedZoneImage() { return TEMPLATE; }

  isUnsafe() { return false; }

  async allowWei(wei) { this.allowances.push(wei); }
}

const V2 = {
  maxPricePerCuHourWei: 65n * 10n ** 16n, maxGflops: 400n, relaysPerHour: 0n, gasLevel: 10n ** 18n, escrowWei: 3n * 10n ** 18n
};

const pathOf = (runner, chain, v2 = {}, options = {}) => {
  const path = new ClaimsPath(runner, chain, claimsSettings({ ...V2, requiredGflops: 250, ...v2 }, options, runner.resources));
  path.imageCid = IMAGE;
  return path;
};

// ------------------------------------------------------------- the approval

test('the mandated node\'s claim is approved at the read of its step', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N1, 1002, true]] });
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N1]]]);
  assert.equal(chain.block, 1002);
});

test('an in-time claim is taken before a late one', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { block: 1003, claims: [[N1, 1003, true], [N5, 1003, true]] });
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N5]]]);
});

test('an early claim waits for the steps before it', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N3, 1001, true]] });
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N3]]]);
  assert.equal(chain.block, 1004);
});

test('a claim below the minimum does not stand', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N1, 1001, true], [N5, 1001, true]], scores: { [N1]: 4999 } });
  assert.equal(await pathOf(runner, chain, {}, { minNodeScore: 0.5 }).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N5]]]);
  assert.equal(chain.block, 1002);
});

test('with no setting a paid class applies the top tier', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N1, 1001, true], [N5, 1001, true]], scores: { [N1]: 20000 }, tier: 24000 });
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N5]]]);
});

test('a default class applies 0.50 once the switch is on, and nothing before', async () => {
  for (const [on, approved] of [[true, N5], [false, N1]]) {
    const runner = new Runner();
    const chain = new FakeChain(runner, { claims: [[N1, 1001, true], [N5, 1001, true]], scores: { [N1]: 4999 }, minimumOn: on });
    const path = pathOf(runner, chain);
    path.defaultClass = true;
    assert.equal(await path.awaitApproval(301, 600), 77);
    assert.deepEqual(chain.sent, [['placeOrder', 301, DP[approved]]]);
  }
});

test('a recent failed order passes the claim over', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N1, 1001, true], [N5, 1001, true]], lastFailures: { [N1]: Math.floor(NOW / SLOT) - 3 } });
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N5]]]);
});

test('a node of the local list is passed over', async () => {
  const runner = new Runner();
  runner.localList.record(IMAGE, N1, 62, NOW - 7200);
  runner.localList.record(IMAGE, N1, 59, NOW - 3600);
  const chain = new FakeChain(runner, { claims: [[N1, 1001, true], [N5, 1001, true]] });
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N5]]]);
});

test('a paid class passes over the node of a recent counted failure', async () => {
  const runner = new Runner({ 40: { dproc: N1 } });
  const health = new Array(20).fill(0n);
  health[3] = 40n | (7n << 48n) | (9n << 96n) | (BigInt(Math.floor(NOW / 86400)) << 144n);
  const chain = new FakeChain(runner, { claims: [[N1, 1001, true], [N5, 1001, true]], health });
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N5]]]);
});

test('an approval the call refuses is left for the next read', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1004, claims: [[N1, 1002, true]] });
  chain.refuse.add('placeOrder');
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), null);
  assert.deepEqual(chain.sent, []);
});

test('the parameter set is the one requestInfo names', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N1, 1002, true]] });
  chain.parameterIndex = 3;
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.parameterReads, [3]);
});

test('a request no parameter set is in force for is given up at once', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N1, 1002, true]] });
  chain.parameterIndex = matching.NO_PARAMETER_SET;
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), null);
  assert.equal(chain.block, 1001);
  assert.deepEqual([chain.sent, chain.parameterReads], [[], []]);
  assert.ok(runner.matchingNotices.some((n) => n.includes('No parameter set of PoxMatching is in force for request 301')));
});

test('a mandated node that cannot claim is passed over at once', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N5, 1001, true]] });
  chain.cannotClaim.add(N1);
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N5]]]);
  assert.equal(chain.block, 1001);
  assert.deepEqual(chain.canClaimReads[0], [N1, N5, N2, N3, LABELS.N4]);
});

test('a canClaimOf read of another stamp reads the round again', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { claims: [[N1, 1002, true]] });
  const answer = chain.canClaimOf.bind(chain);
  let first = true;
  chain.canClaimOf = async (doRequestId, nodes) => {
    const read = await answer(doRequestId, nodes);
    if (first) {
      first = false;
      return { ...read, roundStamp: STAMP_1 };
    }
    return read;
  };
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
  assert.deepEqual([chain.block, chain.canClaimReads.length, chain.listReads], [1002, 2, 2]);
});

// ------------------------------------------------------------- the raise

const raises = (chain) => chain.sent.filter((s) => s[0] === 'increaseBid');

test('no claim can come: the bid is raised within the ceiling', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1008 });
  await pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 18n }).awaitApproval(301, 600);
  assert.deepEqual(raises(chain), [['increaseBid', 301, 7n * 10n ** 17n]]);
  assert.deepEqual(runner.allowances, [10n ** 17n]);
  assert.deepEqual([...new Set(chain.quoteMinimums)], [0]);
});

test('the quote runs over the minimum the runner applies and raises past claimers below it', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1011, claims: [[N1, 1001, true]], scores: { [N1]: 100 } });
  await pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 18n }, { minNodeScore: 0.5 }).awaitApproval(301, 600);
  assert.deepEqual([...new Set(chain.quoteMinimums)], [5000]);
  assert.deepEqual(raises(chain), [['increaseBid', 301, 7n * 10n ** 17n]]);
  assert.ok(runner.matchingNotices.some((n) => n.includes('below the minimum node score')));
});

test('without a ceiling the quote is reported and nothing is raised', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1008 });
  await pathOf(runner, chain).awaitApproval(301, 600);
  assert.deepEqual(raises(chain), []);
  assert.ok(runner.matchingNotices.some((n) => n.includes('no bid ceiling is set')));
});

test('a quote above the ceiling is not sent', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1008 });
  await pathOf(runner, chain, { maxBidPerCuHourWei: 69n * 10n ** 16n }).awaitApproval(301, 600);
  assert.deepEqual(raises(chain), []);
  assert.ok(runner.matchingNotices.some((n) => n.includes('above the bid ceiling')));
});

test('nodes that can still claim hold the raise', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1008, quote: { ...QUOTE_DEFAULT, canClaimNow: 2 } });
  await pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 18n }).awaitApproval(301, 600);
  assert.deepEqual(raises(chain), []);
});

test('after a claim in the round the raise waits for step maxSteps + 1', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1012, claims: [[N1, 1001, false]] });
  await pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 18n }).awaitApproval(301, 600);
  assert.deepEqual(raises(chain), [['increaseBid', 301, 7n * 10n ** 17n]]);
  assert.equal(matching.stepAt(chain.roundBlock, 1000, 1, 1), PARAMS.maxSteps + 1);
});

test('the quote is read again after a raise', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1013 });
  await pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 18n }).awaitApproval(301, 600);
  assert.ok(raises(chain).length >= 2);
  assert.ok(chain.quoteMinimums.length >= 2);
});

test('decideRaise counts rounds and reports a quote that counted no node', () => {
  const quote = { stamp: STAMP_0, counted: 5, canClaimNow: 0, minBidWei: 7n * 10n ** 17n, baseNowWei: 0n, bidWei: 65n * 10n ** 16n, addedEscrowWei: 0n };
  const at = (round) => matching.decideRaise({ quote, claimersCounted: 0, approvableCounted: 0, claimedInRound: false, stepNow: 1, maxSteps: 8, round, maxRounds: 5, ceilingWei: 10n ** 18n });
  assert.equal(at(3).action, matching.RAISE);
  assert.equal(at(4).action, matching.REPORT);
  const none = matching.decideRaise({ quote: { ...quote, counted: 0, minBidWei: matching.UINT256_MAX }, claimersCounted: 0, approvableCounted: 0, claimedInRound: false, stepNow: 1, maxSteps: 8, round: 0, maxRounds: 5, ceilingWei: 10n ** 18n });
  assert.equal(none.action, matching.REPORT);
  assert.match(none.reason, /cannot help/);
});

// ------------------------------------------------------------- the order

const ready = (runner, chain, options) => {
  const path = pathOf(runner, chain, {}, options);
  path.params = { ...PARAMS };
  return path;
};

test('an order not started 900 s after its approval is expired unstarted', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { approvedAt: NOW - 901 });
  const check = await ready(runner, chain).startCheck(77);
  assert.equal(check.started, false);
  assert.match(check.fault, /did not start within 900 s/);
  assert.deepEqual(chain.sent, [['expireUnstarted', 77]]);
});

test('an order inside its 900 s, or started, is left alone', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { approvedAt: NOW - 900 });
  const path = ready(runner, chain);
  assert.deepEqual(await path.startCheck(77), { started: false, fault: null });
  chain.startedAt = NOW - 10;
  chain.approvedAt = NOW - 5000;
  assert.deepEqual(await path.startCheck(77), { started: true, fault: null });
  assert.deepEqual(chain.sent, []);
});

test('expireUnstarted follows its setting', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { approvedAt: NOW - 5000 });
  assert.deepEqual(await ready(runner, chain, { expireUnstarted: false }).startCheck(77), { started: false, fault: null });
  assert.deepEqual(chain.sent, []);
});

test('a pinned order\'s start check reads the parameter set requestInfo names', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { approvedAt: NOW - 901 });
  chain.parameterIndex = 2;
  const check = await pathOf(runner, chain).startCheck(77);
  assert.equal(check.started, false);
  assert.match(check.fault, /did not start within 900 s/);
  assert.deepEqual(chain.parameterReads, [2]);
  assert.deepEqual(chain.sent, [['expireUnstarted', 77]]);
});

test('an expired order is noted for a refund', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner);
  await pathOf(runner, chain).expired(77);
  assert.deepEqual(chain.sent, [['expireOrder', 77], ['noteRefund', 77]]);
});

test('an expiry the PoX does not admit yet waits for settleMatching', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner);
  chain.refuse.add('expireOrder');
  await pathOf(runner, chain, {}, { noteRefund: false }).expired(77);
  assert.deepEqual(chain.sent, []);
  assert.equal(runner.matchingPending.length, 1);
  chain.refuse.clear();
  await settlePending(runner);
  assert.deepEqual(chain.sent, [['expireOrder', 77]]);
  assert.deepEqual(runner.matchingPending, []);
});

const resultWith = (code, fields) => ['v6', String(code), ...new Array(13).fill('x'), ...fields].join(':');

test('a custom class 62 is reported paid and noted an hour later', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner);
  const path = pathOf(runner, chain);
  path.hints = [1n, 2n, 3n];
  const report = await path.afterResult(77, N1, 62, resultWith(62, ['0', '0', '0']));
  assert.equal(report.atFault, 'developer and client');
  assert.match(report.text, /paid to the operator/);
  await settlePending(runner);
  assert.deepEqual(chain.sent, []);
  assert.equal(runner.matchingPending.length, 1);
  chain.time = NOW + 3600;
  await settlePending(runner);
  assert.deepEqual(chain.sent, [['noteAmbiguous', 77, [1n, 2n, 3n]]]);
  assert.deepEqual(runner.matchingPending, []);
});

test('a noted end is not noted again', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner);
  await pathOf(runner, chain).afterResult(77, N1, 47, resultWith(47, ['10', '0', '1']));
  chain.time = NOW + 3600;
  chain.marked = true;
  await settlePending(runner);
  assert.deepEqual(chain.sent, []);
  assert.deepEqual(runner.matchingPending, []);
});

test('a default class 20 is the operator\'s and not noted', async () => {
  const runner = new Runner();
  const report = await pathOf(runner, new FakeChain(runner)).afterResult(77, N1, 20, resultWith(20, ['0', '0', '1']));
  assert.equal(report.atFault, 'operator');
  assert.match(report.text, /whole escrow is refunded/);
  assert.deepEqual(runner.matchingPending, []);
});

test('an end the local list counts is recorded', async () => {
  const runner = new Runner();
  const path = pathOf(runner, new FakeChain(runner));
  await path.afterResult(77, N1, 62, resultWith(62, ['0', '0', '0']));
  assert.equal(runner.localList.blocked(IMAGE, N1, NOW), false);
  await path.afterResult(78, N1, 63, resultWith(63, ['0', '100', '0']));
  assert.equal(runner.localList.blocked(IMAGE, N1, NOW), true);
  assert.equal(runner.localList.blocked(IMAGE, N1, NOW + matching.LOCAL_LIST_SECONDS), false);
  await path.afterResult(79, N2, 0, resultWith(0, ['0', '0', '0']));
  assert.equal(runner.localList.blocked(IMAGE, N2, NOW), false);
  assert.deepEqual(path.chain.earlyReads, []);
});

test('a 33 before its time is settled as a 62, counted and noted', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner);
  chain.early = true;
  const path = pathOf(runner, chain);
  path.hints = [1n, 2n, 3n];
  const report = await path.afterResult(77, N1, 33, resultWith(33, ['0', '0', '0']));
  assert.deepEqual(chain.earlyReads, [77]);
  assert.equal(report.name, 'EXECUTION_TIMEOUT, before its time');
  assert.equal(report.atFault, 'developer and client');
  assert.match(report.text, /task code 33 \(EXECUTION_TIMEOUT, before its time\)/);
  assert.equal(runner.matchingPending[0].kind, 'note');
  assert.equal(runner.localList.blocked(IMAGE, N1, NOW), false);
  await path.afterResult(78, N1, 33, resultWith(33, ['0', '0', '0']));
  assert.equal(runner.localList.blocked(IMAGE, N1, NOW), true);
  const deflt = await path.afterResult(79, N2, 33, resultWith(33, ['0', '0', '1']));
  assert.equal(deflt.atFault, 'operator');
  assert.match(deflt.text, /a 33 before its time the validators do not charge/);
  assert.ok(deflt.ambiguous);
});

test('a 33 at its time is a paid timeout', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner);
  const path = pathOf(runner, chain);
  assert.equal(await path.afterResult(77, N1, 33, resultWith(33, ['0', '0', '0'])), null);
  await path.afterResult(78, N1, 33, resultWith(33, ['0', '0', '0']));
  assert.deepEqual(chain.earlyReads, [77, 78]);
  assert.deepEqual(runner.matchingPending, []);
  assert.equal(runner.localList.blocked(IMAGE, N1, NOW), false);
});

test('the report of each code', () => {
  const custom = { landedAt: 0n, ranUntil: 0n, slClass: 0 };
  const deflt = { landedAt: 0n, ranUntil: 0n, slClass: 1 };
  assert.equal(matching.endReport(44, custom).atFault, 'operator');
  assert.match(matching.endReport(47, custom).settlement, /chain costs are paid/);
  assert.match(matching.endReport(59, { ...custom, ranUntil: 1234n }).settlement, /up to 1234/);
  assert.match(matching.endReport(63, { ...deflt, ranUntil: 99n }).settlement, /up to 99/);
  assert.ok(matching.endReport(62, deflt).ambiguous && matching.endReport(62, custom).ambiguous);
  assert.ok(!matching.endReport(20, deflt).ambiguous && matching.endReport(20, custom).ambiguous);
  assert.ok(!matching.endReport(62, null).ambiguous);
  assert.match(matching.endReport(20, null).settlement, /states no class/);
  assert.equal(matching.endReport(0, custom), null);
  assert.equal(matching.endReport(37, custom), null);
  assert.equal(matching.endReport(33, custom), null);
  assert.ok(matching.endReport(33, custom, true).ambiguous);
  assert.ok(!matching.endReport(33, null, true).ambiguous);
});

test('hints name three matching nodes of the round', () => {
  const entries = LISTED.map((e) => matching.decodeEligible(BigInt(e.word), 0n, matching.placeOf(e.band, e.rollIndex)));
  const hints = hintWords(entries);
  assert.equal(hints.length, 3);
  hints.forEach((hint, i) => {
    const e = entries.filter((x) => x.match)[i];
    assert.equal(Number(hint >> 80n), e.band);
    assert.equal(Number((hint >> 48n) & ((1n << 32n) - 1n)), e.index);
    assert.equal(Number((hint >> 24n) & ((1n << 24n) - 1n)), e.listedOrdinal);
  });
  assert.deepEqual(hintWords(entries.slice(0, 2)), []);
});

// ------------------------------------------------------------- before the add

const ZERO32 = `0x${'00'.repeat(32)}`;

// imageRecords' answer for an image whose records are those given; a minimum
// score of null is unset.
const recordsOf = ({
  kind = matching.KIND_NONE, release = 0, networkOn = false, memory = 0, minScore = null, session = ZERO32,
  latest = ZERO32, currentImage = null, language = null
} = {}) => ({
  registry: '0x1',
  records: { kind, release, networkOn, enclaveMemoryGiB: memory, minScoreSet: minScore !== null, minScore: minScore ?? 0 },
  releaseLanguage: language,
  session,
  latest,
  currentImage
});

class Images extends FakeChain {
  constructor(runner, { health = { s7: 0, f7: 0, nodes: 0, owners: 0, marked: false }, records = null, templateWord = 0n, quote = null, ...rest } = {}) {
    super(runner, rest);
    this.healthAnswer = health;
    this.records = records || { registry: null, records: null, releaseLanguage: null, session: ZERO32, latest: ZERO32, currentImage: null };
    this.templateWord = templateWord;
    this.quoteFor = quote || { counted: 5, minBidWei: 7n * 10n ** 17n, baseNowWei: 6n * 10n ** 17n };
    this.quotesFor = [];
  }

  async template() { return matching.decodeTemplate(this.templateWord); }

  async imageHealth() { return this.healthAnswer; }

  async imageRecords() { return this.records; }

  async bidQuoteFor(terms, templateName, minScore) {
    this.quotesFor.push([terms, templateName, minScore]);
    return this.quoteFor;
  }
}

test('a marked image is refused unless allowed', async () => {
  const runner = new Runner();
  const chain = new Images(runner, { health: { s7: 1, f7: 6, nodes: 3, owners: 3, marked: true } });
  await assert.rejects(() => pathOf(runner, chain).checkBeforeAdd(IMAGE), /marked likely broken/);
  await pathOf(runner, chain, {}, { allowMarkedImage: true }).checkBeforeAdd(IMAGE);
  assert.ok(runner.matchingNotices.some((n) => n.includes('allowMarkedImage is set')));
});

test('an image with no counted order is told', async () => {
  const runner = new Runner();
  await pathOf(runner, new Images(runner)).checkBeforeAdd(IMAGE);
  assert.ok(runner.matchingNotices.some((n) => n.includes('no counted order')));
});

test('a superseded image is refused naming the current one', async () => {
  const runner = new Runner();
  const records = recordsOf({ kind: matching.KIND_DEFAULT_RELEASE, session: `0x${'01'.repeat(32)}`, latest: `0x${'02'.repeat(32)}`, currentImage: 'QmCurrent', language: 1 });
  await assert.rejects(() => pathOf(runner, new Images(runner, { records })).checkBeforeAdd(IMAGE), /QmCurrent/);
});

const MARKED = (1n << 40n) | (1n << 48n);

test('the class is default only on a marked template with the newest session', async () => {
  const records = recordsOf({ kind: matching.KIND_DEFAULT_RELEASE, session: `0x${'01'.repeat(32)}`, latest: `0x${'01'.repeat(32)}`, language: 1 });
  let runner = new Runner();
  let path = pathOf(runner, new Images(runner, { records, templateWord: MARKED }));
  await path.checkBeforeAdd(IMAGE);
  assert.ok(path.defaultClass);
  assert.equal(path.envelope, matching.ENVELOPE_CHUNKED);
  runner = new Runner();
  path = pathOf(runner, new Images(runner, { records, templateWord: 0n }));
  await path.checkBeforeAdd(IMAGE);
  assert.ok(!path.defaultClass);
  assert.equal(path.envelope, matching.ENVELOPE_WHOLE_PASS);
  for (const kind of [matching.KIND_NONE, matching.KIND_NATIVE_PYTHON, matching.KIND_CUSTOM]) {
    runner = new Runner();
    path = pathOf(runner, new Images(runner, { records: { ...records, records: { ...records.records, kind } }, templateWord: MARKED }), {}, { minNodeScore: 0.2 });
    await path.checkBeforeAdd(IMAGE);
    assert.ok(!path.defaultClass);
    assert.ok(runner.matchingNotices.some((n) => n.includes('paid to the operator at the client\'s risk')));
  }
});

test('the image\'s records are told before the add', async () => {
  let runner = new Runner();
  await pathOf(runner, new Images(runner, { records: recordsOf({ kind: matching.KIND_NATIVE_PYTHON, networkOn: true, memory: 4 }), templateWord: MARKED })).checkBeforeAdd(IMAGE);
  assert.equal(runner.matchingNotices.find((n) => n.startsWith('The image registry records')),
    `The image registry records the image ${IMAGE} as native Python: its network is on, its enclave memory 4 GiB, and its minimum operator score not set.`);
  assert.ok(runner.matchingNotices.some((n) => n.includes('custom class (native Python)')));
  runner = new Runner();
  await pathOf(runner, new Images(runner, { records: recordsOf({ kind: matching.KIND_DEFAULT_RELEASE, release: 3, memory: 2, minScore: 45000, language: 2 }) })).checkBeforeAdd(IMAGE);
  assert.ok(runner.matchingNotices.some((n) => n.includes('as default release 3 (Python on WebAssembly): its network is off, its enclave memory 2 GiB, and its minimum operator score 4.5000.')));
  runner = new Runner();
  await pathOf(runner, new Images(runner, { records: recordsOf() })).checkBeforeAdd(IMAGE);
  assert.ok(runner.matchingNotices.includes(`The image registry holds no records of the image ${IMAGE}.`));
});

test('the dApp\'s minimum operator score is the minimum applied', async () => {
  const runner = new Runner();
  const chain = new Images(runner, { records: recordsOf({ kind: matching.KIND_CUSTOM, memory: 2, minScore: 30000 }), templateWord: MARKED, claims: [[N1, 1001, true], [N5, 1001, true]], scores: { [N1]: 20000 } });
  const path = pathOf(runner, chain);
  await path.checkBeforeAdd(IMAGE);
  assert.equal(path.dappMinScore, 30000);
  assert.equal(chain.quotesFor[0][2], 30000);
  assert.equal(await path.awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N5]]]);
});

test('a dApp minimum of 0 switches the test off', async () => {
  const runner = new Runner();
  const chain = new Images(runner, { records: recordsOf({ kind: matching.KIND_CUSTOM, memory: 2, minScore: 0 }), templateWord: MARKED, claims: [[N1, 1001, true], [N5, 1001, true]], scores: { [N1]: 20000 }, tier: 24000 });
  const path = pathOf(runner, chain);
  await path.checkBeforeAdd(IMAGE);
  assert.equal(await path.awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N1]]]);
});

test('the client\'s minimum comes before the dApp\'s and is told', async () => {
  const runner = new Runner();
  const chain = new Images(runner, { records: recordsOf({ kind: matching.KIND_CUSTOM, memory: 2, minScore: 30000 }), templateWord: MARKED, claims: [[N1, 1001, true], [N5, 1001, true]], scores: { [N1]: 20000 } });
  const path = pathOf(runner, chain, {}, { minNodeScore: 0.2 });
  await path.checkBeforeAdd(IMAGE);
  assert.equal(chain.quotesFor[0][2], 2000);
  assert.ok(runner.matchingNotices.some((n) => n.includes('set to 0.2000 for this request, in place of the dApp\'s minimum operator score of 3.0000')));
  assert.equal(await path.awaitApproval(301, 600), 77);
  assert.deepEqual(chain.sent, [['placeOrder', 301, DP[N1]]]);
});

test('the escrow is escrowFor at the request\'s terms', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner);
  const path = pathOf(runner, chain);
  assert.equal(await path.checkEscrow(`v3:${IMAGE}:${TEMPLATE}`), 2n * 10n ** 18n);
  assert.deepEqual(chain.escrowReads, [[1, 65n * 10n ** 16n, (250n << 16n) | 400n, 0n, 10n ** 18n, `v3:${IMAGE}:${TEMPLATE}`]]);
  assert.deepEqual(runner.allowances, [2n * 10n ** 18n]);
  assert.equal(path.escrowWei, 2n * 10n ** 18n);
  assert.ok(runner.matchingNotices.some((n) => n.includes('The request\'s escrow is 2000000000000000000 wei: the work 1600000000000000000 at 400 GFLOPS')));
});

test('escrowWei bounds the escrow and may be left out', async () => {
  let runner = new Runner();
  const chain = new FakeChain(runner);
  const bounded = new ClaimsPath(runner, chain, claimsSettings({ ...V2, escrowWei: 2n * 10n ** 18n - 1n }, { requiredGflops: 250 }, {}));
  await assert.rejects(() => bounded.checkEscrow(`v3:${IMAGE}:${TEMPLATE}`), /above options\.v2\.escrowWei/);
  assert.deepEqual(runner.allowances, []);
  runner = new Runner();
  const open = new ClaimsPath(runner, new FakeChain(runner), claimsSettings({ ...V2, escrowWei: null }, { requiredGflops: 250 }, {}));
  assert.equal(await open.checkEscrow(`v3:${IMAGE}:${TEMPLATE}`), 2n * 10n ** 18n);
  assert.deepEqual(runner.allowances, [2n * 10n ** 18n]);
});

test('a wallet below the escrow is refused before the approval', async () => {
  const runner = new Runner();
  runner.balance = 2n * 10n ** 18n - 1n;
  const path = new ClaimsPath(runner, new FakeChain(runner), claimsSettings({ ...V2, escrowWei: null }, { requiredGflops: 250 }, {}));
  await assert.rejects(() => path.checkEscrow(`v3:${IMAGE}:${TEMPLATE}`), /Insufficient wallet balance/);
  assert.deepEqual(runner.allowances, []);
});

test('the quote before the add takes the request\'s terms', async () => {
  const runner = new Runner();
  const chain = new Images(runner);
  await pathOf(runner, chain).checkBeforeAdd(IMAGE);
  const [terms, template, minimum] = chain.quotesFor[0];
  assert.deepEqual([terms.needGflops, terms.ceilGflops, terms.hours], [250, 400, 1]);
  assert.equal(template, TEMPLATE);
  assert.equal(minimum, 0);
  assert.ok(runner.matchingNotices.some((n) => n.includes('lowest bid at which a listed node matches is 700000000000000000')));
});

test('a pinned node\'s ban is told with its end', async () => {
  const banned = { nodeStanding: async () => ({ score: 0, beatAgeSlots: 0, bannedUntil: NOW + 3600 }), chainTime: async () => NOW };
  assert.match(await pinnedBan(banned, N1), /banned until/);
  assert.equal(await pinnedBan(new FakeChain(new Runner()), N1), null);
});

test('a request without V2 terms is refused before anything is sent', () => {
  assert.throws(() => claimsSettings(null, {}, {}), /V2 terms/);
  assert.throws(() => claimsSettings({ ...V2, maxBidPerCuHourWei: -1 }, {}, {}), /maxBidPerCuHourWei must not be negative/);
  const settings = claimsSettings(V2, {}, {});
  assert.equal(settings.minScore, null);
  assert.equal(settings.recentFailureSlots, 14);
  assert.ok(settings.expireUnstarted && settings.noteRefund && settings.noteAmbiguous);
  assert.ok(!settings.allowMarkedImage);
  assert.equal(settings.maxBidWei, null);
});

// ------------------------------------------------------------- sends

test('a send is made as a call first', async () => {
  const contracts = Object.create(MatchingContracts.prototype);
  const calls = [];
  const fn = Object.assign(async (...args) => { calls.push(['send', ...args]); return { hash: '0x' }; }, {
    staticCall: async (...args) => { calls.push(['call', ...args]); },
    estimateGas: async () => 100n
  });
  await contracts.send({ _placeOrder: fn }, '_placeOrder', [1, 2]);
  assert.deepEqual(calls.map((c) => c[0]), ['call', 'send']);
  const refused = Object.assign(async () => { calls.push(['sent']); }, {
    staticCall: async () => { throw new Error('execution reverted'); },
    estimateGas: async () => 100n
  });
  await assert.rejects(() => contracts.send({ increaseBid: refused }, 'increaseBid', [1, 2]), /reverted/);
  assert.ok(!calls.some((c) => c[0] === 'sent'));
});

// ------------------------------------------------------------- the reads

const POX = `0x${'0a'.repeat(20)}`;
const MATCHING = `0x${'01'.repeat(20)}`;
const READER = `0x${'02'.repeat(20)}`;
const REGISTRY = `0x${'03'.repeat(20)}`;

// A provider answering eth_call from `deployed`: per address, the ABI and the
// answers of its views (a value, an array of the outputs, or a function of the
// call's arguments); each call is kept in `calls` as [address, name, ...args].
const providerOf = (deployed) => {
  const calls = [];
  const provider = {
    calls,
    async call(tx) {
      const at = deployed[String(tx.to).toLowerCase()];
      const iface = new ethers.Interface(at.abi);
      const parsed = iface.parseTransaction({ data: tx.data });
      calls.push([String(tx.to).toLowerCase(), parsed.name, ...parsed.args]);
      const answer = at.answers[parsed.name];
      const value = typeof answer === 'function' ? answer(...parsed.args) : answer;
      return iface.encodeFunctionResult(parsed.fragment, parsed.fragment.outputs.length === 1 ? [value] : value);
    }
  };
  provider.provider = provider;
  return provider;
};

const contractsOn = (deployed) => {
  const provider = providerOf(deployed);
  return { provider, contracts: new MatchingContracts(POX, MATCHING, provider, provider, null) };
};

test('the reader is the one PoxMatching names', async () => {
  let { contracts } = contractsOn({ [MATCHING]: { abi: matchingAbi.matching, answers: { reader: READER } } });
  assert.equal(contracts.reader, null);
  assert.equal((await contracts.bindReader()).toLowerCase(), READER);
  assert.equal(String(contracts.reader.target).toLowerCase(), READER);
  ({ contracts } = contractsOn({ [MATCHING]: { abi: matchingAbi.matching, answers: { reader: ethers.ZeroAddress } } }));
  await assert.rejects(() => contracts.bindReader(), /names no PoxMatchReader/);
  assert.equal(contracts.reader, null);
});

test('requestInfo answers the parameter set and the reads answer by name', async () => {
  const info = Array.from({ length: 21 }, (_, i) => i);
  info[0] = true; info[1] = true; info[2] = false; info[3] = true; info[4] = false; info[6] = STAMP_0; info[7] = STAMP_1; info[19] = true;
  const { provider, contracts } = contractsOn({
    [MATCHING]: { abi: matchingAbi.matching, answers: { reader: READER, early33: true, parameterSet: Array.from({ length: 30 }, (_, i) => (i === 1 ? true : i)) } },
    [READER]: { abi: matchingAbi.reader, answers: { requestInfo: info, canClaimOf: [STAMP_0, [true, false]], escrowFor: [9n, 8n, 1n, 400, 10, 5] } }
  });
  await contracts.bindReader();
  const read = await contracts.requestInfo(301);
  assert.equal(Number(read.parameterSet), 20);
  assert.equal(read.claimedInRound, true);
  const set = await contracts.parameterSet(2);
  assert.equal(set.bandWidth, 15);
  assert.ok(provider.calls.some((c) => c[1] === 'parameterSet' && c[2] === 2n));
  assert.deepEqual(await contracts.canClaimOf(301, [N1, N5]), { roundStamp: STAMP_0, canClaim: [true, false] });
  const asked = provider.calls.find((c) => c[1] === 'canClaimOf');
  assert.deepEqual([...asked[3]].map((a) => a.toLowerCase()), [N1, N5]);
  assert.deepEqual(await contracts.escrowFor(1, 2n, 3n, 4n, 5n, 'v3:a:b'), {
    escrowWei: 9n, workWei: 8n, chainFeeWei: 1n, escrowGflops: 400, trustedZoneFee: 10, secureLockFee: 5
  });
  assert.equal(await contracts.early33(77), true);
  assert.ok(provider.calls.some((c) => c[1] === 'early33' && c[2] === 77n));
});

test('the image\'s records are read through V4\'s views', async () => {
  let held = [1, 3, true, 4, true, 45000, `0x${'01'.repeat(32)}`, `0x${'02'.repeat(32)}`];
  const { provider, contracts } = contractsOn({
    [MATCHING]: { abi: matchingAbi.matching, answers: { imageRegistry: REGISTRY } },
    [REGISTRY]: {
      abi: matchingAbi.imageRegistry,
      answers: {
        imageRecords: () => held,
        defaultRelease: () => [2, 'QmTrustedzone', ZERO32, ZERO32, ZERO32, ZERO32, ZERO32, ZERO32],
        sessionRegistry: ethers.ZeroAddress
      }
    }
  });
  let found = await contracts.imageRecords(IMAGE);
  assert.deepEqual(found.records, { kind: 1, release: 3, networkOn: true, enclaveMemoryGiB: 4, minScoreSet: true, minScore: 45000 });
  assert.equal(found.releaseLanguage, 2);
  assert.ok(provider.calls.some((c) => c[1] === 'defaultRelease' && c[2] === 3n));
  assert.ok(provider.calls.some((c) => c[1] === 'imageRecords' && c[2] === IMAGE));
  held = [3, 0, false, 2, false, 0, ZERO32, ZERO32];
  found = await contracts.imageRecords(IMAGE);
  assert.deepEqual(found.records, { kind: 3, release: 0, networkOn: false, enclaveMemoryGiB: 2, minScoreSet: false, minScore: 0 });
  assert.equal(found.releaseLanguage, null);
  assert.equal(matching.dappMinimum(found.records), null);
});

test('the EPC need is read from the registry PoxMatching names', async () => {
  const { provider, contracts } = contractsOn({
    [MATCHING]: { abi: matchingAbi.matching, answers: { imageRegistry: REGISTRY } },
    [REGISTRY]: { abi: matchingAbi.imageRegistry, answers: { imageEpcUnits: 7 } }
  });
  assert.equal(await contracts.imageEpcUnits(IMAGE), 7);
  assert.ok(provider.calls.some((c) => c[1] === 'imageEpcUnits' && c[2] === IMAGE));
  const none = contractsOn({ [MATCHING]: { abi: matchingAbi.matching, answers: { imageRegistry: ethers.ZeroAddress } } });
  assert.equal(await none.contracts.imageEpcUnits(IMAGE), 0);
});

// ------------------------------------------------------------- the securelock's own session

const SESSIONS = `0x${'04'.repeat(20)}`;
const SESSION = `0x${'01'.repeat(32)}`;
const LATEST = `0x${'09'.repeat(32)}`;
const REVERT = () => Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION', info: { error: { code: 3, message: 'execution reverted' } } });

for (const [boundName, own, kept] of [['sl-session', 'sl-session', true], ['tz-session', 'sl-session', false], ['sl-session', REVERT, false]]) {
  test(`the session sessionOfImage names counts only when it is the securelock's own: bound to ${boundName}, getImageSession ${typeof own === 'function' ? 'refused' : own}`, async () => {
    const { contracts } = contractsOn({
      [MATCHING]: { abi: matchingAbi.matching, answers: { imageRegistry: REGISTRY } },
      [REGISTRY]: {
        abi: matchingAbi.imageRegistry,
        answers: {
          imageRecords: [1, 3, true, 4, true, 45000, ZERO32, ZERO32],
          defaultRelease: () => [1, 'QmTrustedzone', ZERO32, ZERO32, ZERO32, ZERO32, ZERO32, ZERO32],
          sessionRegistry: SESSIONS,
          getImageSession: typeof own === 'function' ? () => { throw own(); } : own
        }
      },
      [SESSIONS]: {
        abi: matchingAbi.sessionRegistry,
        answers: {
          sessionOfImage: SESSION,
          record: (id) => [ZERO32, ethers.ZeroAddress, id === SESSION ? boundName : 'sl-session', 1, '', 'QmCurrent', 1, 0, true],
          latest: LATEST
        }
      }
    });
    const found = await contracts.imageRecords(IMAGE);
    if (kept) {
      assert.deepEqual([found.session, found.latest, found.currentImage], [SESSION, LATEST, 'QmCurrent']);
    } else {
      assert.deepEqual([found.session, found.latest, found.currentImage], [ZERO32, ZERO32, null]);
    }
  });
}

// ------------------------------------------------------------- EPC and memory

test('the claims path states the EPC minimum in the quote, the escrow and the add', async () => {
  const runner = new Runner();
  const chain = new Images(runner);
  chain.epcNeed = 3;
  const path = pathOf(runner, chain, { epcMiB: 100 });
  await path.checkBeforeAdd(IMAGE);
  assert.equal(path.epcUnits, 3);
  assert.deepEqual(chain.epcReads, [IMAGE]);
  assert.equal(chain.quotesFor[0][0].epcUnits, 3);
  await path.checkEscrow(`v3:${IMAGE}:${TEMPLATE}`);
  assert.equal(chain.escrowReads[0][2], (3n << 32n) | (250n << 16n) | 400n);
  const added = [];
  chain.addDORequestV2 = async (...args) => { added.push(args); return { hash: '0xadd' }; };
  await path.addRequest(['a', 'b', 'c', '']);
  assert.equal(added[0][2], (3n << 32n) | (250n << 16n) | 400n);
  assert.ok(runner.matchingNotices.some((n) => n.includes('minimum EPC of 3 units of 64 MiB')));
});

test('the client\'s EPC above the image\'s, and one unit by default', async () => {
  let runner = new Runner();
  let chain = new Images(runner);
  chain.epcNeed = 3;
  let path = pathOf(runner, chain, { epcMiB: 1000 });
  await path.checkBeforeAdd(IMAGE);
  assert.equal(path.epcUnits, 16);
  runner = new Runner();
  chain = new Images(runner);
  path = pathOf(runner, chain);
  await path.checkBeforeAdd(IMAGE);
  assert.equal(path.epcUnits, 1);
  assert.equal(path.maxGflops() >> 32n, 1n);
});

test('a registry that does not answer the EPC need refuses before anything is sent', async () => {
  const runner = new Runner();
  const chain = new Images(runner);
  chain.epcNeed = Object.assign(new Error('request timeout'), { code: 'TIMEOUT' });
  await assert.rejects(() => pathOf(runner, chain).checkBeforeAdd(IMAGE), /did not answer the EPC need/);
  assert.deepEqual(chain.sent, []);
  assert.deepEqual(runner.allowances, []);
  assert.deepEqual(chain.quotesFor, []);
});

test('the memory need is the image\'s enclave memory when it is larger', async () => {
  let runner = new Runner();
  let chain = new Images(runner, { records: recordsOf({ kind: matching.KIND_CUSTOM, memory: 16 }) });
  let path = pathOf(runner, chain);
  await path.checkBeforeAdd(IMAGE);
  assert.equal(path.memoryGb, 16);
  assert.equal(chain.quotesFor[0][0].memGB, 16);
  const added = [];
  chain.addDORequestV2 = async (...args) => { added.push(args); return { hash: '0xadd' }; };
  await path.addRequest(['a', 'b', 'c', '']);
  assert.equal(added[0][0].memory, 16);
  assert.ok(runner.matchingNotices.some((n) => n.includes('records an enclave memory of 16 GiB, above the request\'s memory of 8 GB')));
  runner = new Runner();
  chain = new Images(runner, { records: recordsOf({ kind: matching.KIND_CUSTOM, memory: 4 }) });
  path = pathOf(runner, chain);
  await path.checkBeforeAdd(IMAGE);
  assert.equal(path.memoryGb, 8);
  assert.equal(chain.quotesFor[0][0].memGB, 8);
  assert.ok(!runner.matchingNotices.some((n) => n.includes('records an enclave memory')));
});

// ------------------------------------------------------------- requests that take no claims

const QUOTES = new Map(RANK.quotes.map((c) => [c.name, c]));
const quoteOf = (c) => ({
  counted: c.expected.counted, canClaimNow: c.expected.canClaimNow, minBidWei: BigInt(c.expected.minBidWei),
  baseNowWei: BigInt(c.expected.baseNowWei), bidWei: BigInt(c.expected.bidWei), addedEscrowWei: 10n ** 17n
});

for (const name of ['quote-claims-off', 'quote-cancelled-request']) {
  test(`a request that takes no claims is never raised: ${name}`, async () => {
    const c = QUOTES.get(name);
    assert.equal(c.expected.takesClaims, false);
    assert.equal(c.expected.canClaimNow, 0);
    const runner = new Runner();
    const chain = new FakeChain(runner, { lastBlock: 1008, quote: quoteOf(c) });
    if (name === 'quote-claims-off') chain.claimsOnSet = false;
    else chain.status = 2;
    const path = pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 19n });
    assert.equal(await path.awaitApproval(301, 600), null);
    assert.deepEqual(chain.sent, []);
    assert.deepEqual(runner.allowances, []);
    assert.deepEqual(chain.quoteMinimums, []);
    assert.equal(chain.block, 1001);
    assert.equal(path.claimsOff, name === 'quote-claims-off');
  });
}

test('the same quote with claims taken is raised', async () => {
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1008, quote: quoteOf(QUOTES.get('quote-cancelled-request')) });
  await pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 19n }).awaitApproval(301, 600);
  assert.ok(chain.sent.some((s) => s[0] === 'increaseBid'));
});

test('an open request\'s claimable nodes hold the raise', async () => {
  const c = QUOTES.get('quote-open-request');
  assert.equal(c.expected.takesClaims, true);
  assert.equal(c.expected.canClaimNow, 5);
  const runner = new Runner();
  const chain = new FakeChain(runner, { lastBlock: 1008, quote: quoteOf(c) });
  await pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 19n }).awaitApproval(301, 600);
  assert.ok(!chain.sent.some((s) => s[0] === 'increaseBid'));
});

test('past its age the wait ends for the cancel', async () => {
  let runner = new Runner();
  let chain = new FakeChain(runner, { lastBlock: 1008 });
  chain.createdAt = NOW - PARAMS.maxRequestAgeSeconds - 1;
  const path = pathOf(runner, chain, { maxBidPerCuHourWei: 10n ** 19n });
  assert.equal(await path.awaitApproval(301, 600), null);
  assert.deepEqual(chain.sent, []);
  assert.equal(chain.block, 1001);
  assert.equal(path.claimsOff, false);
  assert.ok(runner.matchingNotices.some((n) => n.includes('past maxRequestAgeSeconds')));
  runner = new Runner();
  chain = new FakeChain(runner, { claims: [[N1, 1002, true]] });
  chain.createdAt = NOW - PARAMS.maxRequestAgeSeconds;
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), 77);
});

test('takesClaims', () => {
  assert.ok(matching.takesClaims(true, 0, 100, 50, 150));
  assert.ok(!matching.takesClaims(true, 0, 100, 50, 151));
  assert.ok(!matching.takesClaims(false, 0, 100, 50, 120));
  assert.ok(!matching.takesClaims(true, 1, 100, 50, 120));
  assert.ok(!matching.takesClaims(true, 2, 100, 50, 120));
});

// ------------------------------------------------------------- receipts

// A send whose receipt has `status`.
const minedAs = (status) => ({ hash: '0xr', wait: async () => ({ status, logs: [] }) });

test('a receipt of status 0 is no success: the approval, noteRefund and noteAmbiguous', async () => {
  let runner = new Runner();
  let chain = new FakeChain(runner, { lastBlock: 1004, claims: [[N1, 1002, true]] });
  chain.placeOrder = async (...args) => { chain.sent.push(['placeOrder', ...args]); return minedAs(0); };
  assert.equal(await pathOf(runner, chain).awaitApproval(301, 600), null);
  assert.ok(chain.sent.length >= 1);
  runner = new Runner();
  chain = new FakeChain(runner);
  chain.noteRefund = async (orderId) => { chain.sent.push(['noteRefund', orderId]); return minedAs(0); };
  await pathOf(runner, chain).expired(77);
  assert.deepEqual(chain.sent, [['expireOrder', 77], ['noteRefund', 77]]);
  assert.ok(!runner.matchingNotices.some((n) => n.includes('noteRefund recorded')));
  assert.ok(runner.matchingNotices.some((n) => n.includes('noteRefund 0xr of order 77 did not succeed')));
  runner = new Runner();
  chain = new FakeChain(runner);
  chain.time = NOW + 7200;
  chain.noteAmbiguous = async (orderId, hints) => { chain.sent.push(['noteAmbiguous', orderId, hints]); return minedAs(0); };
  runner.matchingPending = [{ kind: 'note', order: 77, chain, after: NOW, hints: [1n, 2n, 3n] }];
  await settlePending(runner);
  assert.deepEqual(chain.sent, [['noteAmbiguous', 77, [1n, 2n, 3n]]]);
  assert.deepEqual(runner.matchingPending, []);
  assert.ok(!runner.matchingNotices.some((n) => n.includes('noteAmbiguous of order 77 sent')));
  assert.ok(runner.matchingNotices.some((n) => n.includes('noteAmbiguous 0xr of order 77 did not succeed')));
});
