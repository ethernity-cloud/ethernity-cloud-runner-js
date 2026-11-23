// A request served by claims (claims.ClaimsPath; MATCHING-DESIGN.md section
// 8): the approval of a claim at the read of each block, the raise within the
// bid ceiling over the nodes at or above the minimum, the nodes the runner
// passes over (its local list, a paid class's recent counted failures), the
// order that does not start (expireUnstarted) and the one that expires
// (expireOrder, noteRefund), the report of an end by class and the
// noteAmbiguous sent an hour after the result, and the checks before the add
// (a pinned node's ban, the image's health and registry records, the quote).
//
// The chain is a stand-in for MatchingContracts that answers from Example 1 of
// 3.8 (matching-rank.json `example-1`, bid 1.2 ECLD per CU-hour; its rounds
// open in block 1000, one-block steps after one lead block): its list words,
// and claims mined at the blocks a test names, visible from those blocks on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as matching from '../matching.js';
import { ClaimsPath, claimsSettings, hintWords, pinnedBan, settlePending } from '../claims.js';
import MatchingContracts from '../contract/operation/matchingContract.js';

const RANK = JSON.parse(readFileSync(new URL('./fixtures/matching/matching-rank.json', import.meta.url), 'utf8'));
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
  }

  visible() { return this.claimsList.filter(([, b]) => b <= this.block); }

  async requestInfo() {
    this.block += 1;
    if (this.block > this.lastBlock) this.runner.inFlight = false;
    return {
      settled: true, ranked: true, round: this.round, roundStamp: this.stamp, seed: CASE.expected.seed,
      roundBlock: this.roundBlock,
      closedStep: Math.max(0, matching.stepAt(this.block + 1, this.roundBlock, PARAMS.stepBlocks, PARAMS.leadBlocks) - 1),
      stepNow: matching.stepAt(this.block, this.roundBlock, PARAMS.stepBlocks, PARAMS.leadBlocks),
      claimCount: this.visible().length, claimedInRound: this.visible().length > 0
    };
  }

  async requestParameters() { return { ...PARAMS }; }

  async candidatePages() {
    const entries = LISTED.map((e) => matching.decodeEligible(BigInt(e.word), BigInt(e.priceWei) - BASE, e.rollIndex, 1000));
    const [h, found] = matching.listHashOf(entries, PARAMS.maxSteps);
    return [{
      roundStamp: this.stamp, eligible: LISTED.map((e) => BigInt(e.word)), tips: LISTED.map((e) => BigInt(e.priceWei) - BASE),
      indexes: LISTED.map((e) => e.rollIndex), hOut: h, matchFoundOut: found, nextBand: 0, nextFrom: 0n, done: true, settled: true
    }];
  }

  async claimers(doRequestId, count) {
    return this.visible().slice(0, count).map(([node, block, approvable]) => [node, claimWord(DP[node] ?? 999n, block), approvable]);
  }

  async scheduleOf() { return { roundStamp: this.stamp, complete: true, mandated: [N1, N5, N2, N3, LABELS.N4], canClaim: [true, true, true, true, true] }; }

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
    this.protocolContract = { getOrder: async (id) => orders[id] };
  }

  claimsRunning() { return this.inFlight; }

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
  const path = new ClaimsPath(runner, chain, claimsSettings(V2, { requiredGflops: 250, ...v2 }, options));
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
});

test('hints name three matching nodes of the round', () => {
  const entries = LISTED.map((e) => matching.decodeEligible(BigInt(e.word), 0n, e.rollIndex, 1000));
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

class Images extends FakeChain {
  constructor(runner, { health = { s7: 0, f7: 0, nodes: 0, owners: 0, marked: false }, records = null, templateWord = 0n, quote = null } = {}) {
    super(runner);
    this.healthAnswer = health;
    this.records = records || { registry: null, defaultRelease: false, session: `0x${'00'.repeat(32)}`, latest: `0x${'00'.repeat(32)}`, currentImage: null };
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
  const records = { registry: '0x1', defaultRelease: true, session: `0x${'01'.repeat(32)}`, latest: `0x${'02'.repeat(32)}`, currentImage: 'QmCurrent' };
  await assert.rejects(() => pathOf(runner, new Images(runner, { records })).checkBeforeAdd(IMAGE), /QmCurrent/);
});

test('the class is default only on a marked template with the newest session', async () => {
  const marked = (1n << 40n) | (1n << 48n);
  const records = { registry: '0x1', defaultRelease: true, session: `0x${'01'.repeat(32)}`, latest: `0x${'01'.repeat(32)}`, currentImage: null };
  let runner = new Runner();
  let path = pathOf(runner, new Images(runner, { records, templateWord: marked }));
  await path.checkBeforeAdd(IMAGE);
  assert.ok(path.defaultClass);
  assert.equal(path.envelope, matching.ENVELOPE_CHUNKED);
  runner = new Runner();
  path = pathOf(runner, new Images(runner, { records, templateWord: 0n }));
  await path.checkBeforeAdd(IMAGE);
  assert.ok(!path.defaultClass);
  assert.equal(path.envelope, matching.ENVELOPE_WHOLE_PASS);
  runner = new Runner();
  path = pathOf(runner, new Images(runner, { records: { ...records, defaultRelease: false }, templateWord: marked }), {}, { minNodeScore: 0.2 });
  await path.checkBeforeAdd(IMAGE);
  assert.ok(!path.defaultClass);
  assert.ok(runner.matchingNotices.some((n) => n.includes('paid to the operator at the client\'s risk')));
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
  assert.throws(() => claimsSettings(V2, { maxBidPerCuHourWei: -1 }, {}), /whole number/);
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
