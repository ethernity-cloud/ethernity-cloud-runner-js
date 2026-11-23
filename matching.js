// The runner's side of PoX 2.0 matching (MATCHING-DESIGN.md 3.10, 3.15,
// 3.16, 3.19, 4.4 to 4.7 and section 8; pox-smart-contract-litvm
// spec/matching.md sections 3 to 9, 13 and 17).
//
// Every word and wei amount is a bigint; every hash is keccak256 over the
// packed bytes of spec/matching.md section 3. Nothing here reads the chain:
// contract/operation/matchingContract.js reads it and claims.js drives a
// request through these functions.
//
// - The list of a round from the reader's `candidates` pages (4.5, 4.6): the
//   pages merged under one round stamp, the list hash and the matching count
//   recomputed from the entries the pages returned, the list's order and the
//   mandated sequence (Schedule).
// - The runner's approval rule on closed steps (3.10; spec/matching.md 13).
// - The raise within the client's bid ceiling (3.10 rule 4, 3.15, D92).
// - The minimum score (D62, D71, D88, D138), the recent-failure test (D61)
//   and the runner's local list (3.19, D120).
// - The three result fields after v5 and the report of an end by class
//   (3.19; spec/matching.md 17; section 8 items 15 and 16).
// - The template's record and the envelope its mark chooses (3.19; 8.13).
// - An image's records in ECImageRegistryV4 (8.12; D126, D138, D150).
import { ethers } from 'ethers';

export const SCORE_MAX = 50000;
// The GFLOPS a request that states none requires (D38): one CU.
export const DEFAULT_NEED_GFLOPS = 100;
const UINT16_MAX = 0xffff;
const MASK16 = (1n << 16n) - 1n;
const MASK24 = (1n << 24n) - 1n;
const MASK32 = (1n << 32n) - 1n;
const MASK48 = (1n << 48n) - 1n;
export const UINT64_MAX = (1n << 64n) - 1n;
export const UINT256_MAX = (1n << 256n) - 1n;
// One score unit is 0.0001: a score of 1.00 is 10,000 units.
export const SCORE_UNITS_PER_POINT = 10000;
// The runner's default minimum score, 0.50 (D62), applied once minimumOn()
// answers true (D71, D88).
export const DEFAULT_MIN_SCORE = 5000;
// The slots one cut costs (D61; 3.10 rule 6).
export const DEFAULT_RECENT_FAILURE_SLOTS = 14;
// The runner's local list (3.19, D120): no claim of a node is approved for a
// dApp for LOCAL_LIST_SECONDS after LOCAL_LIST_ENDS of the runner's orders of
// that dApp on that node ended, within LOCAL_LIST_SECONDS, in one of
// LOCAL_LIST_CODES or in a code 33 before its time.
export const LOCAL_LIST_SECONDS = 7 * 86400;
export const LOCAL_LIST_ENDS = 2;
export const LOCAL_LIST_CODES = [20, 59, 62, 63];
// Code 33, EXECUTION_TIMEOUT: before its time (PoxMatching's early33) it is
// settled as a 62 (3.19).
export const CODE_TIMEOUT = 33;
// The parameter set requestInfo names for a request none is in force for.
export const NO_PARAMETER_SET = 256;
// The window of an image's health (3.19): the days d - 6 to d.
export const HEALTH_WINDOW_DAYS = 7;
const DAY_SECONDS = 86400;
// The result's class, field 17 (spec/matching.md 17).
export const CUSTOM_CLASS = 0;
export const DEFAULT_CLASS = 1;
const RESULT_FIELDS_MIN = 18;
const RESULT_FIELD_BOUNDS = [[15, UINT64_MAX], [16, UINT64_MAX], [17, 1n]];

export const ZERO_HASH = ethers.ZeroHash;

// ------------------------------------------------------------- encodings

// A hex address in lower case.
export const addressText = (address) => ethers.getAddress(String(address)).toLowerCase();

// A node's key in a request's order: uint256(keccak256(bytes32 seed, address
// node)) (4.4).
export const keyOf = (seed, node) => BigInt(ethers.solidityPackedKeccak256(['bytes32', 'address'], [seed, node]));

// One link of the list hash: keccak256(bytes32 h, address node, uint8 flags),
// flags = fit + 2 x match (4.5).
export const listLink = (h, node, fit, match) =>
  ethers.solidityPackedKeccak256(['bytes32', 'address', 'uint8'], [h, node, (fit ? 1 : 0) + (match ? 2 : 0)]);

// The key PoxMatching holds a template under: keccak256 of its name, field 2
// of metadata1 (4.2).
export const templateKey = (name) => ethers.keccak256(ethers.toUtf8Bytes(name));

// The key PoxMatching holds an image's health under: the first 31 bytes of
// keccak256 of the securelock image, field 1 of metadata1.
export const imageKey = (imageCid) => ethers.dataSlice(ethers.keccak256(ethers.toUtf8Bytes(imageCid)), 0, 31);

// The V2 add's maxGflops argument of a PoX with matching: the required GFLOPS
// in bits 16 to 31 and the ceiling in bits 0 to 15 (spec/matching.md
// section 3); 0 states none of either. One CU is 100 GFLOPS.
export const maxGflopsArg = (requiredGflops, ceilingGflops) => {
  for (const [name, value] of [['required', requiredGflops], ['ceiling', ceilingGflops]]) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > UINT16_MAX) {
      throw new RangeError(`the ${name} GFLOPS of a request must be 0 to ${UINT16_MAX}, not ${value}`);
    }
  }
  return (BigInt(requiredGflops) << 16n) | BigInt(ceilingGflops);
};

// [need, ceiling] of a maxGflops argument (4.2, D38): a request that states no
// required GFLOPS requires its ceiling when that is below 100, else 100.
export const needOf = (maxGflops) => {
  const arg = BigInt(maxGflops);
  const ceiling = Number(arg & MASK16);
  let need = Number((arg >> 16n) & MASK16);
  if (need === 0) need = ceiling > 0 && ceiling < DEFAULT_NEED_GFLOPS ? ceiling : DEFAULT_NEED_GFLOPS;
  return [need, ceiling];
};

// A score given as points (0.50, 1, 4.9) in units of 0.0001, the unit
// nodeStanding answers in; 0 to 5.00.
export const scoreUnits = (score) => {
  const units = Math.round(Number(score) * SCORE_UNITS_PER_POINT);
  if (!Number.isFinite(units) || units < 0 || units > SCORE_MAX) {
    throw new RangeError(`a minimum node score is 0 to 5.00, not ${score}`);
  }
  return units;
};

// ------------------------------------------------------------- the clock

// step(C) of 4.5 on the clock of a round opened in `roundBlock`, without a
// bound.
export const stepAt = (block, roundBlock, stepBlocks, leadBlocks) => {
  const lead = Number(roundBlock) + Number(leadBlocks);
  if (Number(block) <= lead) return 0;
  return 1 + Math.floor((Number(block) - lead - 1) / Number(stepBlocks));
};

// ------------------------------------------------------------- the words

// A `candidates` place: band << 32 | the entry's index in its band
// (spec/matching.md section 8).
export const placeOf = (band, index) => (BigInt(band) << 32n) | BigInt(index);

// An eligible entry of a list read from a `candidates` word, its tip and its
// place: the word is node << 96 | score << 80 | fit << 73 | match << 72 |
// listedOrdinal << 48 | dpRequestId, the place band << 32 | index, the band
// being the roll array the entry stands in.
export const decodeEligible = (word, tip, place) => {
  const w = BigInt(word);
  const p = BigInt(place);
  return {
    node: ethers.toBeHex(w >> 96n, 20),
    score: Number((w >> 80n) & MASK16),
    fit: ((w >> 73n) & 1n) === 1n,
    match: ((w >> 72n) & 1n) === 1n,
    listedOrdinal: Number((w >> 48n) & MASK24),
    dpRequestId: w & MASK48,
    tip: BigInt(tip),
    band: Number((p >> 32n) & 255n),
    index: Number(p & MASK32)
  };
};

// A claim record (PoxMatchingState.Claim) from its word: the offer, the block
// and time it was mined at, its round, its step on that round's clock bounded
// by maxSteps + 1, its state, the steps it states (four bits a round) and the
// tip it was admitted at; null for a node with no claim (block 0).
export const decodeClaim = (word) => {
  const w = BigInt(word);
  const block = (w >> 48n) & MASK48;
  if (block === 0n) return null;
  const packed = (w >> 128n) & MASK32;
  return {
    dpRequestId: w & MASK48,
    block: Number(block),
    time: Number((w >> 96n) & MASK32),
    round: Number(packed & 15n),
    step: Number((packed >> 4n) & 15n),
    state: Number((packed >> 8n) & 15n),
    stated: packed >> 12n,
    tip: w >> 160n
  };
};

// A trustedzone template's record (PoxMatchingState.Template) from the word
// templateOf answers: its bit, when it was registered, its mark and the
// release's timeout constants.
export const decodeTemplate = (word) => {
  const w = BigInt(word);
  const field = (shift, mask) => Number((w >> BigInt(shift)) & mask);
  return {
    bit: field(0, 255n),
    registeredAt: field(8, MASK32),
    marked: field(40, 255n) !== 0,
    registered: field(48, 255n) !== 0,
    stopMarginSeconds: field(56, MASK16),
    agentWindowSeconds: field(72, MASK16),
    endBudgetSeconds: field(88, MASK16),
    chainLagSeconds: field(104, MASK16),
    startTimeoutSeconds: field(120, MASK16)
  };
};

// The envelope a request's payload and input travel in (8.13): the chunked
// envelope for a marked template's trustedzone (D76), the whole-pass format
// for every other.
export const ENVELOPE_CHUNKED = 'chunked';
export const ENVELOPE_WHOLE_PASS = 'whole-pass';
export const envelopeFor = (template) =>
  (template && template.registered && template.marked ? ENVELOPE_CHUNKED : ENVELOPE_WHOLE_PASS);

// The counted failures healthOf's twenty words hold (words 3 to 18: order,
// node tag, owner tag, day) whose day is in the window of 7 days at `now`
// (days d - 6 to d), the empty entries left out.
export const recentHealthFailures = (words, now) => {
  const today = Math.floor(Number(now) / DAY_SECONDS);
  const found = [];
  for (const raw of Array.from(words).slice(3, 19)) {
    const w = BigInt(raw);
    const failure = {
      orderId: w & MASK48,
      nodeTag: (w >> 48n) & MASK48,
      ownerTag: (w >> 96n) & MASK48,
      day: Number((w >> 144n) & MASK32)
    };
    if (failure.day === 0 && failure.orderId === 0n) continue;
    if (failure.day >= today - (HEALTH_WINDOW_DAYS - 1) && failure.day <= today) found.push(failure);
  }
  return found;
};

// ------------------------------------------------------------- the list

// The pages of one list read answered different round stamps: a raise or a
// replaced block came between them, and the read starts again.
export class StampChanged extends Error {}

// A page of a list read was answered at a block that is not settled for the
// round (4.1): nothing is ranked, approved or raised on it.
export class Unsettled extends Error {}

// [listHash, matchFound, stopBand] of eligible entries in roll order (4.5):
// every entry of the bands 49 down to stopBand is linked, stopBand being the
// band of the maxSteps-th matching entry, 0 when fewer match.
export const listHashOf = (entries, maxSteps) => {
  let h = ZERO_HASH;
  let found = 0;
  let stop = null;
  for (const e of entries) {
    if (stop !== null && e.band < stop) break;
    h = listLink(h, e.node, e.fit, e.match);
    if (e.match && found < maxSteps) {
      found += 1;
      if (found === Number(maxSteps)) stop = e.band;
    }
  }
  return [h, found, stop === null ? 0 : stop];
};

// One list read from its `candidates` pages in the order they were read, each
// an object of the view's answers (roundStamp, eligible, tips, places, hOut,
// matchFoundOut, done, settled). Throws StampChanged when two pages answer
// different stamps, Unsettled for a page not settled, and an Error when the
// list hash or the matching count computed from the entries differs from the
// one the last page carried (a page left out or answered for another read).
// The entries are those of every page, in roll order, each in the band its
// place names.
export const mergeCandidates = (pages, maxSteps) => {
  let stamp = null;
  const entries = [];
  let last = null;
  for (const page of pages) {
    const pageStamp = ethers.hexlify(page.roundStamp);
    if (stamp !== null && pageStamp !== stamp) throw new StampChanged('the pages of the list read answered two round stamps');
    stamp = pageStamp;
    if (!page.settled) throw new Unsettled('a page of the list read is not settled for the round');
    page.eligible.forEach((word, i) => entries.push(decodeEligible(word, page.tips[i], page.places[i])));
    last = page;
  }
  if (last === null) throw new Error('a list read needs one page at least');
  const [listHash, matchFound, stopBand] = listHashOf(entries, Number(maxSteps));
  if (listHash !== ethers.hexlify(last.hOut) || matchFound !== Number(last.matchFoundOut)) {
    throw new Error('the list hash or the matching count of the pages is not the one the reader carried');
  }
  return { stamp, entries, listHash, matchFound, stopBand, done: Boolean(last.done) };
};

// The schedule of a round (4.4, 4.5) from its eligible entries in roll order:
// the list's order (band descending, then key, then address), each listed
// node's 1-based position, and the mandated sequence, the first maxSteps of
// F(49), R(49), F(48), R(48), ..., F(0), R(0). The entries must reach the end
// of the stop band for the mandated sequence; the positions of nodes below it
// need the entries read on with `beyond`.
export class Schedule {
  constructor(entries, seed, maxSteps) {
    const keys = new Map(entries.map((e) => [e.node, keyOf(seed, e.node)]));
    const compare = (a, b) => {
      if (a.band !== b.band) return b.band - a.band;
      const ka = keys.get(a.node);
      const kb = keys.get(b.node);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return BigInt(a.node) < BigInt(b.node) ? -1 : 1;
    };
    this.order = [...entries].sort(compare);
    this.position = new Map(this.order.map((e, i) => [e.node, i + 1]));
    const mandated = [];
    const bands = [...new Set(this.order.map((e) => e.band))];
    for (const band of bands) {
      const inBand = this.order.filter((e) => e.band === band);
      const fit = inBand.filter((e) => e.match && e.fit).map((e) => e.node);
      const rest = inBand.filter((e) => e.match && !e.fit).map((e) => e.node);
      mandated.push(...fit.concat(rest).slice(0, Number(maxSteps) - mandated.length));
    }
    this.mandated = mandated;
  }
}

// ------------------------------------------------------------- approval

// Whether a node's last failed order is in the last `recentFailureSlots`
// slots (3.10 rule 6): slotNow - lastFailureSlot < recentFailureSlots, for a
// recorded failure.
export const recentFailure = (standing, slotNow, recentFailureSlots) => {
  const last = Number(standing.lastFailureSlot);
  return last !== 0 && Number(slotNow) - last < Number(recentFailureSlots);
};

// The runner's approval rule at one read (3.10; spec/matching.md 13).
// `mandated` is the round's mandated sequence in step order, `position` the
// list position of each listed node (a Map), `claims` every claim on the
// request (a Map of { block, approvable, dpRequestId }), `standings` every
// claimer's and mandated node's { score, canAnswer, lastFailureSlot }, and
// `excluded` the nodes the runner approves no claim of (its local list, and
// for a paid class the claimers the image's recent counted failures name);
// `closed` is the last closed step of the read, all on the clock of the round
// opened in `roundBlock`.
//
// A claim stands when it is approvable, its node is not excluded and its
// node's score is at least `minScore`. Rule 1: among the mandated nodes whose
// claim stands, whose last failed order is not recent and whose earlier steps
// are all closed or passed over, the claim mined in its node's step or
// earlier with the lowest step, else the lowest step. A mandated node is
// passed over at once when it cannot answer, its claim is not approvable, its
// failed order is recent or it is excluded; a claim below the minimum is
// treated as absent, so its node's step must close. While a mandated step is
// neither closed nor passed over the runner waits. Rule 3: the standing
// claims, those without a recent failed order first, mandated nodes by step,
// then the list's nodes by position, then nodes outside the list by the
// block of their claim; one with a recent failed order only when no other
// stands. The decision is { approve, rule, inTime, wait, belowMinimum }.
export const decideApproval = ({
  mandated, position, claims, standings, excluded, closed, minScore, recentFailureSlots, slotNow,
  roundBlock, stepBlocks, leadBlocks
}) => {
  const out = new Set([...excluded].map((n) => n.toLowerCase()));
  const recent = (n) => recentFailure(standings.get(n), slotNow, recentFailureSlots);
  const stands = (n) => {
    const c = claims.get(n);
    return Boolean(c && c.approvable && !out.has(n) && standings.get(n).score >= minScore);
  };
  const passedOver = (n) => {
    const c = claims.get(n);
    return !standings.get(n).canAnswer || Boolean(c && !c.approvable) || recent(n) || out.has(n);
  };
  const done = mandated.map((n, i) => i + 1 <= closed || passedOver(n));
  let first = null;
  for (let j = 1; j <= mandated.length; j++) {
    const n = mandated[j - 1];
    if (!done.slice(0, j - 1).every(Boolean) || !stands(n) || recent(n)) continue;
    if (stepAt(claims.get(n).block, roundBlock, stepBlocks, leadBlocks) <= j) {
      return { approve: n, rule: 1, inTime: true, wait: false, belowMinimum: [] };
    }
    if (first === null) first = n;
  }
  if (first !== null) return { approve: first, rule: 1, inTime: false, wait: false, belowMinimum: [] };
  if (!done.every(Boolean)) return { approve: null, rule: null, inTime: null, wait: true, belowMinimum: [] };
  const standing = [...claims.keys()].filter(stands);
  if (standing.length) {
    const rank = (n) => {
      if (mandated.includes(n)) return [0, mandated.indexOf(n), 0, 0n];
      if (position.has(n)) return [1, position.get(n), 0, 0n];
      return [2, 0, claims.get(n).block, BigInt(n)];
    };
    const compare = (a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < 4; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
      return 0;
    };
    const fresh = standing.filter((n) => !recent(n)).sort(compare);
    const chosen = fresh.length ? fresh[0] : [...standing].sort(compare)[0];
    return { approve: chosen, rule: 3, inTime: null, wait: false, belowMinimum: [] };
  }
  const belowMinimum = [...claims.entries()]
    .filter(([n, c]) => c.approvable && !out.has(n) && standings.get(n).score < minScore)
    .map(([n]) => n)
    .sort();
  return { approve: null, rule: null, inTime: null, wait: false, belowMinimum };
};

// ------------------------------------------------------------- the raise

// The quote for a raise merged over its bidQuote pages in the order read
// (4.6): the counts add up; the lowest bid is the last page's, each page
// carrying the one before it; the added escrow is the last page's (answered
// with `done`). Throws StampChanged for two stamps.
export const mergeQuote = (pages) => {
  let stamp = null;
  let counted = 0;
  let canClaimNow = 0;
  let last = null;
  for (const page of pages) {
    const pageStamp = ethers.hexlify(page.roundStamp);
    if (stamp !== null && pageStamp !== stamp) throw new StampChanged('the pages of the quote answered two round stamps');
    stamp = pageStamp;
    counted += Number(page.counted);
    canClaimNow += Number(page.canClaimNow);
    last = page;
  }
  if (last === null) throw new Error('a quote needs one page at least');
  return {
    stamp,
    counted,
    canClaimNow,
    minBidWei: BigInt(last.minBidWei),
    baseNowWei: BigInt(last.baseNowWei),
    bidWei: BigInt(last.bidWei),
    addedEscrowWei: BigInt(last.addedEscrowWei)
  };
};

// The bid a raise sends (4.6): max(minBidWei, bid + 1); a quote at or below
// the bid in force names a network price that fell since the round, which a
// raise of one wei stamps.
export const sendBid = (minBidWei, bidWei) => {
  const next = BigInt(bidWei) + 1n;
  return BigInt(minBidWei) > next ? BigInt(minBidWei) : next;
};

export const RAISE = 'raise';
export const WAIT = 'wait';
export const REPORT = 'report';

// Whether to raise the bid (3.10 rule 4, 3.15, D92, D23) when the approval
// rule found no standing claim: { action, bidWei, reason }, `action` being
// RAISE with the bid to send, WAIT while a claim the runner would approve can
// still come or the contract does not admit the raise yet, or REPORT when a
// raise cannot be sent. `quote` is the reader's quote over the nodes at or
// above the minimum the runner applies, so claimers below it hold nothing
// back; `claimersCounted` is the number of claimers at or above that minimum
// and `approvableCounted` how many of their claims can be approved now.
//
// No claim the runner would approve can come when no counted node can claim
// at the bid in force, or every one that can has claimed and none of those
// claims can be approved. A quote that counted no node cannot be helped by a
// raise. The contract admits a raise while nobody claimed in the round and,
// once a claim was mined in it, from step maxSteps + 1; a request is raised
// at most maxRounds - 1 times. The bid sent is max(minBidWei, bid + 1), sent
// only within the client's ceiling; with no ceiling the quote is reported.
export const decideRaise = ({
  quote, claimersCounted, approvableCounted, claimedInRound, stepNow, maxSteps, round, maxRounds, ceilingWei
}) => {
  if (quote.counted === 0 || quote.minBidWei === UINT256_MAX) {
    return { action: REPORT, bidWei: null, reason: 'no listed node at or above the minimum score covers the request\'s resources and template: a raise cannot help' };
  }
  const canCome = quote.canClaimNow > 0 && !(claimersCounted >= quote.canClaimNow && approvableCounted === 0);
  if (canCome) return { action: WAIT, bidWei: null, reason: `${quote.canClaimNow} listed node(s) can claim at the bid in force` };
  const bid = sendBid(quote.minBidWei, quote.bidWei);
  if (Number(round) + 1 >= Number(maxRounds)) {
    return { action: REPORT, bidWei: bid, reason: `the request has had ${Number(round) + 1} round(s), the most a request has (maxRounds ${maxRounds}): its bid is not raised again` };
  }
  if (ceilingWei === null || ceilingWei === undefined) {
    return { action: REPORT, bidWei: bid, reason: `a listed node matches at ${bid} wei per CU-hour; no bid ceiling is set, so the bid is not raised` };
  }
  if (bid > BigInt(ceilingWei)) {
    return { action: REPORT, bidWei: bid, reason: `the lowest matching bid, ${bid} wei per CU-hour, is above the bid ceiling of ${BigInt(ceilingWei)}` };
  }
  if (claimedInRound && Number(stepNow) <= Number(maxSteps)) {
    return { action: WAIT, bidWei: bid, reason: `a claim was mined in this round: the contract admits a raise from step ${Number(maxSteps) + 1}` };
  }
  return { action: RAISE, bidWei: bid, reason: `no claim can come at the bid in force; raising to ${bid} wei per CU-hour` };
};

// ------------------------------------------------------------- minimum

// The minimum score the runner applies to a request (3.10 rule 5, D62, D71,
// D88, D138): the one the developer or the client set, 0 included, as set;
// else the dApp's minimum operator score the image registry records; else,
// for a dApp provably of the default class, 0.50 once minimumOn() answers
// true and 0 before; else the top tier, `tier`, the boundary tierScore
// answers for the request's round (0 while it is not read).
export const minimumScore = ({ explicit, dappMinimum, defaultClass, minimumOn, tier }) => {
  if (explicit !== null && explicit !== undefined) return Number(explicit);
  if (dappMinimum !== null && dappMinimum !== undefined) return Number(dappMinimum);
  if (defaultClass) return minimumOn ? DEFAULT_MIN_SCORE : 0;
  return Number(tier || 0);
};

// The runner's local list (3.19, D120): from its own orders, the nodes whose
// claims it approves for no request of a dApp for LOCAL_LIST_SECONDS after
// LOCAL_LIST_ENDS of its orders of that dApp on that node ended, in either
// class, in code 20, 62, a 33 before its time, 59 or 63, all within
// LOCAL_LIST_SECONDS. Held in memory for the runner's life.
export class LocalList {
  constructor() {
    this.ends = new Map();
  }

  // Records an order of `imageCid` on `node` that ended at `at` with `code`,
  // `early33` stating whether a code 33 was a timeout before its time
  // (PoxMatching's early33); an end the list does not count is not kept.
  record(imageCid, node, code, at, early33 = false) {
    if (!LOCAL_LIST_CODES.includes(Number(code)) && !(Number(code) === CODE_TIMEOUT && early33)) return;
    const key = `${imageCid}|${addressText(node)}`;
    if (!this.ends.has(key)) this.ends.set(key, []);
    this.ends.get(key).push(Number(at));
  }

  // Whether no claim of `node` is approved for `imageCid` at `now`.
  blocked(imageCid, node, now) {
    const ends = (this.ends.get(`${imageCid}|${addressText(node)}`) || []).filter((t) => t <= now).sort((a, b) => a - b);
    for (let i = 0; i + LOCAL_LIST_ENDS <= ends.length; i++) {
      const window = ends.slice(i, i + LOCAL_LIST_ENDS);
      if (window[window.length - 1] - window[0] <= LOCAL_LIST_SECONDS && now - window[window.length - 1] < LOCAL_LIST_SECONDS) return true;
    }
    return false;
  }

  // The nodes `imageCid`'s list holds at `now`.
  nodes(imageCid, now) {
    const found = [];
    for (const key of this.ends.keys()) {
      const [image, node] = key.split('|');
      if (image === imageCid && this.blocked(image, node, now)) found.push(node);
    }
    return found.sort();
  }
}

// ------------------------------------------------------------- results

const DIGITS = /^(0|[1-9][0-9]*)$/;

// Fields 15 to 17 of the result string the trustedzone signed
// (spec/matching.md 17): { landedAt, ranUntil, slClass }, each read when the
// result has 18 fields or more and each of the three is in the form and at
// most its bound; null otherwise, a result that states no class. Fields after
// 17 are not read.
export const resultFields = (result) => {
  const fields = String(result).split(':');
  if (fields.length < RESULT_FIELDS_MIN) return null;
  const values = [];
  for (const [index, bound] of RESULT_FIELD_BOUNDS) {
    if (!DIGITS.test(fields[index])) return null;
    const value = BigInt(fields[index]);
    if (value > bound) return null;
    values.push(value);
  }
  return { landedAt: values[0], ranUntil: values[1], slClass: Number(values[2]) };
};

// The ends section 8 item 16 reports by class, with their names (3.19; SLH 7).
export const END_NAMES = {
  20: 'SIGNATURE_ERROR',
  44: 'TRUSTEDZONE_FAILURE',
  47: 'CHAIN_UNAVAILABLE',
  59: 'NETWORK_UNAVAILABLE',
  62: 'SECURELOCK_SILENT',
  63: 'PAYLOAD_LOST'
};
export const EARLY_TIMEOUT_NAME = 'EXECUTION_TIMEOUT, before its time';
// The ends PoxMatching's noteAmbiguous takes (3.19): 47, 59 and 63 in every
// class, a default-class 62, and a custom class's 20 and 62; a 33 before its
// time as a 62.
const AMBIGUOUS_ANY_CLASS = [47, 59, 63];
const AMBIGUOUS_CUSTOM_CLASS = [20, 62];

// The report of an order that closed with code 20, 62, 44, 47, 59 or 63, or
// with a 33 before its time (`early33`, PoxMatching's early33), which is
// settled as a 62 (section 8 item 16; 3.19); null for any other code:
// { code, name, slClass, atFault, settlement, ambiguous, text }. The class is
// the result's field 17; a result that states none is of a trustedzone before
// the release, whose 20 and 62 are paid as a valid result.
export const endReport = (code, fields, early33 = false) => {
  const c = Number(code);
  const early = c === CODE_TIMEOUT && Boolean(early33);
  const settled = early ? 62 : c;
  if (!(settled in END_NAMES)) return null;
  const name = early ? EARLY_TIMEOUT_NAME : END_NAMES[c];
  const silent = early ? '33 before its time' : '62';
  const slClass = fields ? fields.slClass : null;
  let atFault;
  let settlement;
  if ((settled === 20 || settled === 62) && slClass === DEFAULT_CLASS) {
    atFault = 'operator';
    settlement = `the whole escrow is refunded and the node is charged; a ${silent} the validators do not charge for want of their probes is refunded with the node's chain costs paid`;
  } else if (settled === 20 || settled === 62) {
    atFault = slClass === CUSTOM_CLASS ? 'developer and client' : 'not stated';
    settlement = slClass === CUSTOM_CLASS
      ? 'the order is paid to the operator in full, at the developer\'s and the client\'s risk'
      : 'the result states no class: the order is settled as a valid result';
  } else if (c === 44) {
    atFault = 'operator';
    settlement = 'the whole escrow is refunded and the node is charged, in every class';
  } else if (c === 47) {
    atFault = 'the network\'s endpoint or the operator';
    settlement = 'the work and the fees on it are refunded and the node\'s chain costs are paid; the node is charged when the validators\' probes show the endpoint answering';
  } else {
    atFault = c === 59 ? 'the outside service, the network or the operator' : 'the backend or the operator';
    settlement = `the work up to ${fields ? fields.ranUntil : 0n} (ranUntil) is paid and the work after it is refunded`;
  }
  const ambiguous = AMBIGUOUS_ANY_CLASS.includes(settled)
    || (AMBIGUOUS_CUSTOM_CLASS.includes(settled) && slClass === CUSTOM_CLASS)
    || (settled === 62 && slClass === DEFAULT_CLASS);
  const text = `The order failed with no result, task code ${c} (${name}); at fault: ${atFault}; ${settlement}.`;
  return { code: c, name, slClass, atFault, settlement, ambiguous: ambiguous && fields !== null, text };
};

// ------------------------------------------------------------- image records

// The kinds of an image's records in ECImageRegistryV4
// (IECImageRegistryV4.ImageRecords.kind).
export const KIND_NONE = 0;
export const KIND_DEFAULT_RELEASE = 1;
export const KIND_NATIVE_PYTHON = 2;
export const KIND_CUSTOM = 3;
// A default release's language (IECImageRegistryV4.DefaultRelease.language).
export const RELEASE_LANGUAGES = { 1: 'JavaScript', 2: 'Python on WebAssembly' };

// The dApp's minimum operator score an image's records hold (D138): the score
// when it is set, 0 included, which switches the test off; null when it is
// unset or no records are held. `records` is { kind, release, networkOn,
// enclaveMemoryGiB, minScoreSet, minScore } as imageRecords answers them.
export const dappMinimum = (records) => (records && records.minScoreSet ? Number(records.minScore) : null);

// The kind of an image's records in words: a default release with its index
// and language, native Python, a custom securelock.
export const kindText = (records, language) => {
  if (records.kind === KIND_DEFAULT_RELEASE) {
    return `default release ${records.release} (${RELEASE_LANGUAGES[language] || `language ${language}`})`;
  }
  if (records.kind === KIND_NATIVE_PYTHON) return 'native Python';
  if (records.kind === KIND_CUSTOM) return 'a custom securelock';
  return `kind ${records.kind}`;
};

// What the image registry shows of an image before an add (8.12): its kind,
// whether its network is on, its enclave memory and its minimum operator
// score.
export const recordsText = (imageCid, records, language) => {
  if (records.kind === KIND_NONE) return `The image registry holds no records of the image ${imageCid}.`;
  const minimum = records.minScoreSet ? (records.minScore / SCORE_UNITS_PER_POINT).toFixed(4) : 'not set';
  return `The image registry records the image ${imageCid} as ${kindText(records, language)}: its network is ${records.networkOn ? 'on' : 'off'}, its enclave memory ${records.enclaveMemoryGiB} GiB, and its minimum operator score ${minimum}.`;
};
