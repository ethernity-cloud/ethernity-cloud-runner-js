// matching.js (MATCHING-DESIGN.md 3.10, 3.15, 4.4 to 4.6; spec/matching.md
// sections 3 to 9, 13 and 17) on the shared fixtures of
// pox-smart-contract-litvm spec/ at specCopies.SOURCE_COMMIT, held byte for
// byte in test/fixtures/ (specManifest.test.js checks the copies), and the
// runner's ABI entries (contract/abi/matchingAbi.js) against that commit's.
//
// ranking.json holds, per ranking case, the reader's `candidates` answers;
// the runner's merge of those pages, its list hash, its matching count, the
// band each entry's place names and its mandated sequence equal the reader's
// answers and each roll node's turn. matching-rank.json holds the reference
// rule's results: the seed, the keys, the need, the template and image keys,
// the list's order, the mandated sequence, the stop band, the steps, the
// pages of a paged read, the approval rule's decisions and the bid a raise
// sends. result-fields.json holds the results whose fields 15 to 17 are read
// and those whose fields are not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import * as matching from '../matching.js';
import * as matchingAbi from '../contract/abi/matchingAbi.js';
import EthernityCloudRunner from '../runner.js';
import protocolContractPolygon from '../contract/abi/polygonProtocolAbi.js';
import { V2_ADD_ABI } from '../contract/operation/matchingContract.js';
import { SOURCE_COMMIT, checkout, load, shownAt } from './specCopies.js';

const RANKING = load('ranking.json');
const RANK = load('matching-rank.json');
const FIELDS = load('result-fields.json');
const RANK_CASES = new Map(RANK.ranking.map((c) => [c.name, c]));

// Where each group of the runner's ABI entries comes from, in the source
// commit unless another is named; an artifact holds its ABI under "abi".
// pox12 is the V2 add of a PoX that answers VERSION() "1.2", the entry of
// 7611a81, before the minimum EPC took bits 32 to 47 of maxGflops.
const ABI_SOURCES = {
  pox: 'abi/EthernityImplementationV2_2_0.json',
  pox12: ['7611a81', 'abi/EthernityImplementationV2_2_0.json'],
  pricing: 'abi/IPoxPricing.json',
  matching: 'abi/IPoxMatching.json',
  reader: 'abi/IPoxMatchReader.json',
  imageRegistry: 'abi/IECImageRegistryV4.json',
  sessionRegistry: 'artifacts/PoxMatchingState.sol/IMatchingSessionRegistry.json'
};
// The file of abi-selectors.json's `entries` each group's rows are in. The
// session registry (ethernity-cas's SessionRegistry, read through
// IMatchingSessionRegistry) is not among the ABIs abi-selectors.json lists;
// pox12 is the `before` form of its `changed` addDORequestV2.
const SELECTOR_FILES = {
  pox: 'EthernityImplementationV2_2_0.json',
  pricing: 'IPoxPricing.json',
  matching: 'IPoxMatching.json',
  reader: 'IPoxMatchReader.json',
  imageRegistry: 'ECImageRegistryV4.json'
};
const SELECTORS = load('abi-selectors.json');
const CHANGED = Object.fromEntries(SELECTORS.changed.map((c) => [c.name, c]));
// An event's topic0, a function's or an error's selector (abi-selectors.json
// `rule`), with its canonical signature.
const rowOf = (fragment) => [fragment.format('sighash'), fragment.type === 'event' ? fragment.topicHash : fragment.selector];
const fragmentOf = (group, name) => new ethers.Interface(matchingAbi[group]).getFunction(name);

for (const [group, file] of Object.entries(SELECTOR_FILES)) {
  test(`each ${group} ABI entry is its row of abi-selectors.json`, () => {
    const rows = new Map(SELECTORS.entries.map((r) => [`${r.abi}|${r.kind}|${r.signature}`, r.selector || r.topic0]));
    for (const fragment of new ethers.Interface(matchingAbi[group]).fragments) {
      const [signature, selector] = rowOf(fragment);
      const key = `${file}|${fragment.type}|${signature}`;
      assert.ok(rows.has(key), key);
      assert.equal(selector, rows.get(key), key);
    }
  });
}

test('the 1.2 add is the before form of the changed add, the 2.0 add its now form', () => {
  const changed = CHANGED.addDORequestV2;
  assert.deepEqual(rowOf(fragmentOf('pox12', 'addDORequestV2')), [changed.before, changed.beforeValue]);
  assert.deepEqual(rowOf(fragmentOf('pox', 'addDORequestV2')), [changed.signature, changed.now]);
});

for (const name of ['bidQuoteFor', 'escrowFor']) {
  test(`the reader's ${name} is its now form`, () => {
    assert.deepEqual(rowOf(fragmentOf('reader', name)), [CHANGED[name].signature, CHANGED[name].now]);
  });
}

test('the generation signals are the selectors the runner reads', () => {
  assert.equal(fragmentOf('pox', 'VERSION').selector, SELECTORS.signals.version.selector);
  assert.equal(fragmentOf('pricing', 'matching').selector, SELECTORS.signals.matching.selector);
  assert.deepEqual(Object.keys(V2_ADD_ABI).sort(), SELECTORS.signals.version.answers.map((a) => a.value).sort());
});

for (const [group, where] of Object.entries(ABI_SOURCES)) {
  test(`the ${group} ABI entries are the source commit's`, (t) => {
    const [commit, file] = Array.isArray(where) ? where : [SOURCE_COMMIT, where];
    const source = shownAt(file, commit);
    if (source === null) {
      t.skip(`no pox-smart-contract-litvm checkout holding ${commit} (found: ${checkout()})`);
      return;
    }
    const parsed = JSON.parse(source.toString('utf8'));
    const contract = new ethers.Interface(Array.isArray(parsed) ? parsed : parsed.abi);
    for (const fragment of new ethers.Interface(matchingAbi[group]).fragments) {
      const found = fragment.type === 'event' ? contract.getEvent(fragment.topicHash) : contract.getFunction(fragment.selector);
      assert.ok(found, fragment.format('full'));
      assert.equal(fragment.format('full'), found.format('full'));
    }
  });
}

// ------------------------------------------------------------- helpers

// The reader's list word of a fixture entry (spec/matching.md 3).
const wordOf = (e) => (BigInt(e.node) << 96n) | (BigInt(e.score) << 80n) | (BigInt(e.fit ? 1 : 0) << 73n)
  | (BigInt(e.match ? 1 : 0) << 72n) | (BigInt(e.listedOrdinal) << 48n) | BigInt(e.dpRequestId);

const pageOf = (stamp, entries, read) => ({
  roundStamp: stamp,
  eligible: entries.map(wordOf),
  tips: entries.map((e) => BigInt(e.tipWei)),
  places: entries.map((e) => matching.placeOf(e.band, e.index)),
  hOut: read.listHash,
  matchFoundOut: read.matchFound,
  done: read.done,
  settled: read.settled
});

const setOf = (c) => c.parameterSets[c.expected.parameterSetIndex];

// The eligible entries of a matching-rank.json ranking case in roll order,
// decoded from the words its list holds.
const entriesOf = (rankCase) => {
  const { expected } = rankCase;
  const base = expected.baseWei ? BigInt(expected.baseWei) : 0n;
  return [...(expected.list || [])]
    .sort((a, b) => (b.band - a.band) || (a.rollIndex - b.rollIndex))
    .map((e) => matching.decodeEligible(BigInt(e.word), BigInt(e.priceWei) - base, matching.placeOf(e.band, e.rollIndex)));
};

const STAMP = `0x${'01'.repeat(32)}`;

// The last step whose last block is `block` or earlier (4.5), as requestInfo
// answers it.
const closedStep = (block, roundBlock, stepBlocks, leadBlocks) =>
  Math.max(0, matching.stepAt(block + 1, roundBlock, stepBlocks, leadBlocks) - 1);

// Field 1 of a result string, the task code.
const codeOf = (result) => Number(result.split(':')[1]);

// ------------------------------------------------------------- ranking.json

for (const c of RANKING.cases) {
  test(`the merged read is the reader's: ${c.name}`, () => {
    const params = c.parameterSet;
    const { read } = c.candidates;
    let pages = [pageOf(STAMP, read.eligible, read)];
    const { beyond } = c.candidates;
    if (beyond) pages.push(pageOf(STAMP, beyond.eligible, { ...beyond, listHash: read.listHash, matchFound: read.matchFound }));
    if (!read.settled) {
      assert.throws(() => matching.mergeCandidates(pages, params.maxSteps), matching.Unsettled);
      pages = pages.map((p) => ({ ...p, settled: true }));
    }
    const merged = matching.mergeCandidates(pages, params.maxSteps);
    assert.equal(merged.listHash, read.listHash);
    assert.equal(merged.matchFound, read.matchFound);
    const answered = read.eligible.concat(beyond ? beyond.eligible : []);
    assert.deepEqual(merged.entries.map((e) => [e.band, e.index]), answered.map((e) => [e.band, e.index]));
    const bands = new Set(c.roll.bands.flatMap((b) => b.entries.map((e) => `${e.node}|${b.band}`)));
    for (const e of merged.entries) assert.ok(bands.has(`${e.node}|${e.band}`), e.node);
    const schedule = new matching.Schedule(merged.entries, c.request.seed, params.maxSteps);
    for (const turn of c.turns) {
      if (!turn.eligible || !turn.done) continue;
      assert.equal(schedule.mandated.indexOf(turn.node) + 1, turn.mandateStep, turn.node);
    }
  });
}

test('a page of another stamp restarts the read', () => {
  const { read } = RANKING.cases[0].candidates;
  const first = pageOf(STAMP, read.eligible.slice(0, 2), { ...read, done: false });
  const second = pageOf(`0x${'02'.repeat(32)}`, read.eligible.slice(2), read);
  assert.throws(() => matching.mergeCandidates([first, second], 8), matching.StampChanged);
});

test('a page left out is found by the hash', () => {
  const { read } = RANKING.cases[0].candidates;
  assert.throws(() => matching.mergeCandidates([pageOf(STAMP, read.eligible.slice(1), read)], 8), /list hash/);
});

// An entry written into its band under another bandWidth stands in the band
// its place names: two scores of band 24 at a bandWidth of 1,000, one of them
// in band 12, the second matching entry of a read with maxSteps 2 ending the
// stop band there.
test('the band is the place\'s, not the score\'s', () => {
  const [first, second] = RANKING.cases[0].candidates.read.eligible.slice(0, 2).map((e) => ({ ...e }));
  Object.assign(first, { score: 24500, band: 24, index: 0, match: true });
  Object.assign(second, { score: 24900, band: 12, index: 3, match: true });
  const entries = [first, second].map((e) => matching.decodeEligible(wordOf(e), BigInt(e.tipWei), matching.placeOf(e.band, e.index)));
  const [listHash, matchFound, stopBand] = matching.listHashOf(entries, 2);
  const merged = matching.mergeCandidates([pageOf(STAMP, [first, second], { listHash, matchFound, done: true, settled: true })], 2);
  assert.deepEqual(merged.entries.map((e) => [e.band, e.index]), [[24, 0], [12, 3]]);
  assert.equal(merged.stopBand, 12);
  assert.equal(stopBand, 12);
  assert.deepEqual(new matching.Schedule(merged.entries, ethers.ZeroHash, 2).order.map((e) => e.node), [first.node, second.node]);
});

// ------------------------------------------------------- matching-rank.json

for (const c of RANK.ranking) {
  test(`the ranking case ${c.name}`, () => {
    const { expected, request } = c;
    const params = setOf(c);
    assert.equal(ethers.solidityPackedKeccak256(['bytes22', 'uint256'], [request.seedStamp, BigInt(request.id)]), expected.seed);
    assert.deepEqual(matching.needOf(request.maxGflopsArg), [expected.needGflops, expected.ceilGflops]);
    assert.equal(matching.templateKey(expected.templateName), expected.templateKey);
    assert.equal(matching.imageKey(request.metadata1.split(':')[1]), expected.imageKey);
    const entries = entriesOf(c);
    const listed = [...(expected.list || [])].sort((a, b) => (b.band - a.band) || (a.rollIndex - b.rollIndex));
    entries.forEach((e, i) => {
      const l = listed[i];
      assert.deepEqual([e.node, e.band, e.fit, e.match, e.listedOrdinal, e.dpRequestId],
        [l.node, l.band, l.fit, l.match, l.listedOrdinal, BigInt(l.dpRequestId)]);
      assert.equal(`0x${matching.keyOf(expected.seed, e.node).toString(16).padStart(64, '0')}`, l.key);
    });
    if (!expected.ranked) {
      assert.deepEqual(entries, []);
      return;
    }
    assert.deepEqual(matching.listHashOf(entries, params.maxSteps), [expected.listHash, expected.matchFound, expected.stopBand]);
    const schedule = new matching.Schedule(entries, expected.seed, params.maxSteps);
    assert.deepEqual(schedule.order.map((e) => e.node), expected.list.map((e) => e.node));
    assert.deepEqual(Object.fromEntries(schedule.position), Object.fromEntries(expected.list.map((e) => [e.node, e.position])));
    assert.deepEqual(schedule.mandated, expected.mandated);
    for (const [node, turn] of Object.entries(expected.turns)) {
      assert.equal(schedule.mandated.indexOf(node) + 1, turn.mandateStep, node);
    }
    for (const block of expected.steps) {
      assert.equal(matching.stepAt(block.block, expected.roundBlock, params.stepBlocks, params.leadBlocks), block.step);
      assert.equal(closedStep(block.block, expected.roundBlock, params.stepBlocks, params.leadBlocks), block.closedStep);
    }
  });
}

for (const c of RANK.paging) {
  test(`the paged read ${c.name}`, () => {
    const setup = RANK_CASES.get(c.setup);
    const params = setOf(setup);
    const pages = [];
    let merged;
    for (const page of c.expected.pages) {
      const places = page.eligible.map((e) => matching.placeOf(e.band, e.index));
      page.eligible.forEach((e, i) => {
        const decoded = matching.decodeEligible(BigInt(e.word), BigInt(e.tipWei), places[i]);
        assert.deepEqual([decoded.band, decoded.index], [e.band, e.index]);
      });
      pages.push({
        roundStamp: STAMP,
        eligible: page.eligible.map((e) => BigInt(e.word)),
        tips: page.eligible.map((e) => BigInt(e.tipWei)),
        places,
        hOut: page.hOut,
        matchFoundOut: page.matchFoundOut,
        done: page.done,
        settled: true
      });
      merged = matching.mergeCandidates(pages, params.maxSteps);
      assert.equal(merged.done, page.done);
    }
    assert.equal(merged.listHash, c.expected.listHash);
    assert.deepEqual([merged.matchFound, merged.stopBand], [c.expected.matchFound, c.expected.stopBand]);
  });
}

const standingsOf = (c, nodes) => new Map([...nodes].map((node) => {
  const given = c.nodes[node] || {};
  return [node, {
    score: given.score ?? matching.SCORE_MAX,
    canAnswer: given.canAnswer ?? true,
    lastFailureSlot: given.lastFailureSlot ?? 0
  }];
}));

for (const c of RANK.approvals) {
  test(`the approval rule: ${c.name}`, () => {
    const setup = RANK_CASES.get(c.setup);
    const params = setOf(setup);
    const roundBlock = setup.rounds[setup.round].block;
    const schedule = new matching.Schedule(entriesOf(setup), setup.expected.seed, params.maxSteps);
    const claims = new Map(c.claims.map((cl) => [cl.node, {
      block: cl.block, approvable: (c.nodes[cl.node] || {}).approvable ?? true, dpRequestId: 0n
    }]));
    const standings = standingsOf(c, new Set([...schedule.mandated, ...claims.keys()]));
    let minScore = c.minimumOn ? matching.DEFAULT_MIN_SCORE : 0;
    if (c.developerMinScore !== undefined && c.developerMinScore !== null) minScore = c.developerMinScore;
    const closed = closedStep(c.readBlock, roundBlock, params.stepBlocks, params.leadBlocks);
    const decision = matching.decideApproval({
      mandated: schedule.mandated, position: schedule.position, claims, standings, excluded: [], closed, minScore,
      recentFailureSlots: c.recentFailureSlots, slotNow: c.slotNow, roundBlock,
      stepBlocks: params.stepBlocks, leadBlocks: params.leadBlocks
    });
    assert.equal(closed, c.expected.closedStep);
    assert.equal(decision.approve, c.expected.approve);
    assert.equal(decision.rule, c.expected.rule);
    if ('inTime' in c.expected) assert.equal(decision.inTime, c.expected.inTime);
    assert.equal(decision.wait, c.expected.wait ?? false);
  });
}

test('an excluded mandated node is passed over at once', () => {
  const setup = RANK_CASES.get('example-1');
  const params = setOf(setup);
  const schedule = new matching.Schedule(entriesOf(setup), setup.expected.seed, params.maxSteps);
  const [n1, n5] = schedule.mandated;
  const claims = new Map([[n1, { block: 1001, approvable: true }], [n5, { block: 1001, approvable: true }]]);
  const standings = standingsOf({ nodes: {} }, new Set([...schedule.mandated, ...claims.keys()]));
  const decision = matching.decideApproval({
    mandated: schedule.mandated, position: schedule.position, claims, standings, excluded: [n1], closed: 0,
    minScore: 0, recentFailureSlots: 14, slotNow: 41551, roundBlock: 1000, stepBlocks: 1, leadBlocks: 1
  });
  assert.deepEqual([decision.approve, decision.rule], [n5, 1]);
});

test('claims below the minimum are named when none stands', () => {
  const setup = RANK_CASES.get('example-1');
  const params = setOf(setup);
  const schedule = new matching.Schedule(entriesOf(setup), setup.expected.seed, params.maxSteps);
  const [n1] = schedule.mandated;
  const claims = new Map([[n1, { block: 1001, approvable: true }]]);
  const standings = new Map(schedule.mandated.map((n) => [n, { score: n === n1 ? 4999 : 50000, canAnswer: true, lastFailureSlot: 0 }]));
  const decision = matching.decideApproval({
    mandated: schedule.mandated, position: schedule.position, claims, standings, excluded: [], closed: 6,
    minScore: 5000, recentFailureSlots: 14, slotNow: 41551, roundBlock: 1000, stepBlocks: 1, leadBlocks: 1
  });
  assert.deepEqual(decision, { approve: null, rule: null, inTime: null, wait: false, belowMinimum: [n1] });
});

for (const c of RANK.quotes) {
  test(`the bid a raise sends: ${c.name}`, (t) => {
    if (!('sendBidWei' in c.expected)) {
      t.skip('a quote for terms names no bid in force');
      return;
    }
    assert.equal(matching.sendBid(BigInt(c.expected.minBidWei), BigInt(c.expected.bidWei)), BigInt(c.expected.sendBidWei));
  });
}

const quoteOf = (c) => ({
  stamp: STAMP,
  counted: c.expected.counted,
  canClaimNow: c.expected.canClaimNow,
  minBidWei: BigInt(c.expected.minBidWei),
  baseNowWei: BigInt(c.expected.baseNowWei),
  bidWei: BigInt(c.expected.bidWei),
  addedEscrowWei: 0n
});

const raiseOf = (quote, claimersCounted, approvableCounted, stepNow) => matching.decideRaise({
  quote, claimersCounted, approvableCounted, claimedInRound: false, stepNow, maxSteps: 8, round: 0, maxRounds: 5,
  ceilingWei: 10n ** 19n
});

for (const name of ['quote-raise-example', 'quote-with-ceiling-min-score', 'quote-fallen-price']) {
  test(`a quote no claim can come at is raised to its bid: ${name}`, () => {
    const c = RANK.quotes.find((q) => q.name === name);
    const decision = raiseOf(quoteOf(c), 0, 0, 1);
    assert.deepEqual([decision.action, decision.bidWei], [matching.RAISE, BigInt(c.expected.sendBidWei)]);
  });
}

test('a quote with claimable nodes waits until they have claimed and none is approvable', () => {
  const c = RANK.quotes.find((q) => q.name === 'quote-without-ceiling');
  assert.equal(raiseOf(quoteOf(c), 0, 0, 1).action, matching.WAIT);
  assert.equal(raiseOf(quoteOf(c), 1, 0, 1).action, matching.WAIT);
  const raised = raiseOf(quoteOf(c), 2, 0, 9);
  assert.deepEqual([raised.action, raised.bidWei], [matching.RAISE, BigInt(c.expected.sendBidWei)]);
});

// ------------------------------------------------------- result-fields.json

for (const v of FIELDS.accepted) {
  test(`the three fields are read: ${v.name}`, () => {
    assert.equal(codeOf(v.result), v.expected.code);
    assert.deepEqual(matching.resultFields(v.result), {
      landedAt: BigInt(v.expected.landedAt), ranUntil: BigInt(v.expected.ranUntil), slClass: v.expected.slClass
    });
  });
}

for (const v of FIELDS.refused) {
  test(`the three fields are not read: ${v.name}`, () => {
    assert.equal(codeOf(v.result), v.expected.code);
    assert.equal(matching.resultFields(v.result), null);
  });
}

for (const v of FIELDS.stored) {
  test(`the stored result's grammar: ${v.name}`, () => {
    const read = matching.readStored(v.stored, FIELDS.transaction.orderId);
    assert.equal(read.status, v.expected.status);
    if (v.expected.transaction) {
      assert.deepEqual([read.orderId, read.signer], [v.expected.orderId, v.expected.signer]);
    } else {
      assert.deepEqual(read, { status: v.expected.status, orderId: null, code: null, signer: null });
    }
    assert.equal(read.code, v.expected.status === matching.STORED_DECODED ? v.expected.code : null);
  });
}

test('the grammar\'s vectors cover every status', () => {
  assert.deepEqual(new Set(FIELDS.stored.map((v) => v.expected.status)), new Set([
    matching.STORED_DECODED, matching.STORED_NOT_V3, matching.STORED_NO_TRANSACTION, matching.STORED_OTHER_ORDER,
    matching.STORED_NO_CODE
  ]));
  assert.equal(FIELDS.stored.length, 53);
});

test('the stored form of each result is decoded for its order and is another order\'s for any other', () => {
  for (const v of [...FIELDS.accepted, ...FIELDS.refused]) {
    const read = matching.readStored(v.stored, FIELDS.transaction.orderId);
    assert.deepEqual([read.status, read.code], [matching.STORED_DECODED, v.expected.code], v.name);
    const other = matching.readStored(v.stored, FIELDS.transaction.orderId + 1);
    assert.deepEqual([other.status, other.orderId], [matching.STORED_OTHER_ORDER, FIELDS.transaction.orderId], v.name);
  }
});

test('every stored result carries its result string through the runner\'s parse', () => {
  const runner = new EthernityCloudRunner('LOCAL');
  runner.protocolAbi = protocolContractPolygon.abi;
  for (const v of [...FIELDS.accepted, ...FIELDS.refused]) {
    const parsed = runner.parseTransactionBytes(runner.parseOrderResult(v.stored).transactionBytes);
    assert.equal(parsed.result, v.result, v.name);
    assert.equal(parsed.orderId, BigInt(FIELDS.transaction.orderId), v.name);
  }
});
