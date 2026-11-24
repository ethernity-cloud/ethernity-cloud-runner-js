// A request served by claims (MATCHING-DESIGN.md section 8): the checks before
// its V2 add, the approval of a claim by the rule of 3.10, the raise of 3.15,
// the order that does not start (expireUnstarted) or expires (expireOrder and
// noteRefund), the report of its end by class and the noteAmbiguous the
// members have not sent (3.16, 3.19).
//
// EthernityCloudRunner builds a ClaimsPath for a request on a network whose
// PoX's pricing names a PoxMatching when claimsOn() answers true before the
// add, on the PoxMatchReader PoxMatching names; on every other network, and
// while claims are off, it serves the request without claims (8.4), with V2
// terms (TermedRequest) when options.v2 gives them with an escrowWei.
import { ethers } from 'ethers';
import * as matching from './matching.js';
import { requestTerms } from './contract/operation/requestTerms.js';
import { sendV2Add } from './contract/operation/matchingContract.js';
import { delay } from './utils.js';
import { ECLog } from './enums.js';

// How long after an order's result the runner sends noteAmbiguous itself when
// the validators' members have not (section 8 item 16).
export const NOTE_AMBIGUOUS_AFTER_SECONDS = 3600;
// The number of matching nodes of the approval's round a noteAmbiguous names
// as its hints, the proof that three nodes could serve the request (3.19).
const HINT_NODES = 3;

// The V2 terms of options.v2 of run() and runSession(), as bigints:
// maxPricePerCuHourWei (the most paid per CU-hour, token weis; required),
// maxGflops (the largest node paid for, in GFLOPS, one CU being 100 GFLOPS; 0
// for any node), relaysPerHour and gasLevel of the chain fee, and escrowWei,
// the escrow addDORequestV2 pulls, on the claims path the most it may pull
// (null when left out). A field left out takes its default (OD26: maxGflops
// 0, relaysPerHour 0, gasLevel 1e18). Each field is a bigint, a string of
// decimal digits (surrounding whitespace allowed) or a safe integer; the empty
// string, a boolean and a hex string are refused. Null when `v2` is not
// given.
export const V2_TERM_FIELDS = ['maxPricePerCuHourWei', 'maxGflops', 'relaysPerHour', 'gasLevel', 'escrowWei'];
const V2_TERM_DEFAULTS = { maxGflops: 0n, relaysPerHour: 0n, gasLevel: 10n ** 18n, escrowWei: null };

const integerOf = (value, name) => {
  let parsed;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    parsed = BigInt(value.trim());
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else {
    throw new TypeError(`${name} must be an integer (a bigint, a decimal string or a safe integer)`);
  }
  if (parsed < 0n) throw new TypeError(`${name} must not be negative`);
  return parsed;
};

export const v2TermsOf = (v2) => {
  if (v2 === undefined || v2 === null) return null;
  if (typeof v2 !== 'object') throw new TypeError('options.v2 must be an object with the V2 terms');
  const terms = {};
  for (const field of V2_TERM_FIELDS) {
    const value = v2[field];
    terms[field] = (value === undefined || value === null) && field !== 'maxPricePerCuHourWei'
      ? V2_TERM_DEFAULTS[field]
      : integerOf(value, `options.v2.${field}`);
  }
  if (terms.maxPricePerCuHourWei === 0n) throw new TypeError('options.v2.maxPricePerCuHourWei must be above 0');
  if (terms.escrowWei === 0n) throw new TypeError('options.v2.escrowWei must be above 0');
  return terms;
};

const within = (name, value, low, high) => {
  if (value !== null && (value < low || value > high)) {
    throw new RangeError(`${name} must be ${low} to ${high}, not ${value}: the PoX refuses a request outside that bound`);
  }
  return value;
};

// The settings a request with V2 terms reads (section 8 items 1, 5, 6, 9,
// 10, 12 and 16): the V2 terms of options.v2 (v2TermsOf), with its
// requiredGflops (0: one CU, D38), epcMiB (the client's EPC figure in MiB,
// rounded up to units of 64 MiB; OD23) and maxBidPerCuHourWei, the bid
// ceiling a raise stays within (none: the quote is reported and nothing is
// raised); and of `options`, for the claims path, minNodeScore (points, 0.50;
// 0 switches the test off), recentFailureSlots, allowMarkedImage,
// expireUnstarted, noteRefund and noteAmbiguous. Each bound the PoX sets on
// the terms (matching.MAX_PRICE_WEI, MIN_GAS_LEVEL, MAX_GAS_LEVEL,
// maxGflopsArg) is tested, and a V2 add takes one instance (`resources`'
// validators, 0 read as 1). Null when options.v2 is not given; throws, before
// anything is sent, for a setting out of its range or out of the PoX's bound.
export const v2Settings = (v2, options = {}, resources = {}) => {
  const terms = v2TermsOf(v2);
  if (terms === null) return null;
  const validators = (resources && resources.validators) || 1;
  if (Number(validators) !== 1) {
    throw new RangeError(`A request with V2 terms takes one instance; resources.validators is ${validators}. Give validators 1, or leave options.v2 out for a legacy request.`);
  }
  const whole = (value, name, fallback) => (value === undefined || value === null ? fallback : integerOf(value, name));
  within('options.v2.maxPricePerCuHourWei', terms.maxPricePerCuHourWei, 1n, matching.MAX_PRICE_WEI);
  within('options.v2.gasLevel', terms.gasLevel, matching.MIN_GAS_LEVEL, matching.MAX_GAS_LEVEL);
  const requiredGflops = Number(whole(v2.requiredGflops, 'options.v2.requiredGflops', 0n));
  const epcUnits = matching.epcUnitsOfMib(whole(v2.epcMiB, 'options.v2.epcMiB', 0n));
  matching.maxGflopsArg(requiredGflops, Number(terms.maxGflops), epcUnits);
  return {
    terms,
    requiredGflops,
    epcUnits,
    maxBidWei: within('options.v2.maxBidPerCuHourWei', whole(v2.maxBidPerCuHourWei, 'options.v2.maxBidPerCuHourWei', null),
      1n, matching.MAX_PRICE_WEI),
    minScore: options.minNodeScore === undefined || options.minNodeScore === null ? null : matching.scoreUnits(options.minNodeScore),
    recentFailureSlots: Number(whole(options.recentFailureSlots, 'options.recentFailureSlots', BigInt(matching.DEFAULT_RECENT_FAILURE_SLOTS))),
    allowMarkedImage: Boolean(options.allowMarkedImage),
    expireUnstarted: options.expireUnstarted !== false,
    noteRefund: options.noteRefund !== false,
    noteAmbiguous: options.noteAmbiguous !== false
  };
};

// The settings of a request served by claims (v2Settings). Throws, before
// anything is sent, for a request without V2 terms and as v2Settings does.
export const claimsSettings = (v2, options = {}, resources = {}) => {
  const settings = v2Settings(v2, options, resources);
  if (!settings) {
    throw new Error('This network serves DO requests by claims (PoxMatching\'s claimsOn() is true), so a request is added with V2 terms: pass options.v2 with maxPricePerCuHourWei; its escrowWei, when given, is the most addDORequestV2 may pull.');
  }
  return settings;
};

// requestInfo names no parameter set in force for the request
// (matching.NO_PARAMETER_SET): it has no schedule, so no claim on it is
// approved by the rule of 3.10.
export class NoParameterSet extends Error {}

// The parameter set the request takes has claims off (requestInfo's
// `claims`): no claim on it is made or approved, and it is served as a
// request without claims (8.4).
export class ClaimsOff extends Error {}

// The request takes no claims now (matching.takesClaims): the storage no
// longer holds it AVAILABLE, or it is past maxRequestAgeSeconds. No claim on
// it is approved and its bid is not raised.
export class NoClaimsNow extends Error {}

const utc = (seconds) => new Date(Number(seconds) * 1000).toISOString();

// Why no order can be placed on `node` now (D33, 8.11): the message naming the
// end of its ban, or null for a node that is not banned.
export const pinnedBan = async (chain, node) => {
  const { bannedUntil } = await chain.nodeStanding(node);
  const now = await chain.chainTime();
  if (now < bannedUntil) {
    return `The node ${node} is banned until ${utc(bannedUntil)} (${bannedUntil}): no order can be placed on it before then, so the request pinned to it is not sent.`;
  }
  return null;
};

// The hints of a noteAmbiguous (3.19): the first HINT_NODES matching entries
// of the approval's round in roll order, each band << 80 | rollIndex << 48 |
// listedOrdinal << 24 | listedOrdinal; none when fewer match.
export const hintWords = (entries) => {
  const found = entries.filter((e) => e.match).slice(0, HINT_NODES);
  if (found.length < HINT_NODES) return [];
  return found.map((e) => (BigInt(e.band) << 80n) | (BigInt(e.index) << 48n) | (BigInt(e.listedOrdinal) << 24n) | BigInt(e.listedOrdinal));
};

// expireOrder of `orderId`, made as a call first, then noteRefund when
// `noteRefund`; false when the PoX does not admit the expiry yet. Each send
// is waited for with the runner's receipt poll (runner.receiptOf), and one
// whose receipt is not of status 1 has not succeeded.
export const expireOrder = async (chain, runner, orderId, noteRefund) => {
  try {
    await runner.receiptOf(await chain.expireOrder(orderId));
  } catch (e) {
    return false;
  }
  runner.matchingNotice(`Order ${orderId} had no result in its time and was expired: its escrow is returned.`);
  if (noteRefund) {
    let tx;
    try {
      tx = await chain.noteRefund(orderId);
    } catch (e) {
      runner.matchingNotice(`noteRefund of order ${orderId} is refused: ${e.shortMessage || e.message}`, ECLog.INFO);
      return true;
    }
    try {
      await runner.receiptOf(tx);
      runner.matchingNotice(`noteRefund recorded order ${orderId}'s expiry against its node.`, ECLog.INFO);
    } catch (e) {
      runner.matchingNotice(`noteRefund ${tx.hash} of order ${orderId} did not succeed: ${e.shortMessage || e.message}`, ECLog.INFO);
    }
  }
  return true;
};

// The work a request left for later (runner.matchingPending): an expiry the
// PoX now admits, sent with its noteRefund, and a noteAmbiguous due an hour
// after its result that the validators' members have not sent, made as a call
// first. Work that is not due stays; work the contracts refuse is dropped.
export const settlePending = async (runner) => {
  const keep = [];
  for (const item of runner.matchingPending) {
    const { chain } = item;
    try {
      if (item.kind === 'expire') {
        if (!(await expireOrder(chain, runner, item.order, item.noteRefund))) keep.push(item);
        continue;
      }
      if ((await chain.chainTime()) < item.after) {
        keep.push(item);
        continue;
      }
      if (await chain.orderMarked(item.order)) continue;
      const tx = await chain.noteAmbiguous(item.order, item.hints);
      try {
        await runner.receiptOf(tx);
      } catch (e) {
        runner.matchingNotice(`noteAmbiguous ${tx.hash} of order ${item.order} did not succeed: ${e.shortMessage || e.message}`, ECLog.INFO);
        continue;
      }
      runner.matchingNotice(`noteAmbiguous of order ${item.order} sent: the members had not sent it within an hour of the result.`, ECLog.INFO);
    } catch (e) {
      runner.logAppend(`pending ${item.kind} of order ${item.order}: ${e.shortMessage || e.message}`, ECLog.INFO);
    }
  }
  runner.matchingPending = keep;
};

// One request served by claims, from the checks before its add to the report
// of its order's end. `runner` is the EthernityCloudRunner whose run this is,
// `chain` the run's MatchingContracts.
export class ClaimsPath {
  constructor(runner, chain, settings) {
    this.runner = runner;
    this.chain = chain;
    this.settings = settings;
    this.imageCid = null;
    this.template = null;
    this.envelope = matching.ENVELOPE_WHOLE_PASS;
    this.defaultClass = false;
    // The image's records in the image registry (imageRecords; null when
    // PoxMatching names no registry) and the dApp's minimum operator score
    // they hold (matching.dappMinimum).
    this.records = null;
    this.dappMinScore = null;
    // The request's memory need, the larger of the client's memory and the
    // image's enclave memory (matching.memoryNeed), and its minimum EPC in
    // units of 64 MiB (matching.minimumEpc), set before the add.
    this.memoryGb = null;
    this.epcUnits = null;
    // The escrow the add pulls, escrowFor at the request's terms.
    this.escrowWei = null;
    this.params = null;
    this.round = null;
    this.hints = [];
    // True once awaitApproval found the request's set with claims off.
    this.claimsOff = false;
    this.told = new Set();
  }

  notice(text, level = ECLog.WARNING) {
    this.runner.matchingNotice(text, level);
  }

  noticeOnce(key, text, level = ECLog.WARNING) {
    if (this.told.has(key)) return;
    this.told.add(key);
    this.notice(text, level);
  }

  templateName() {
    return this.runner.resolveTrustedZoneImage();
  }

  // The reads before the add (8.1, 8.6, 8.12, 8.13, 3.19): the template's
  // record and the envelope its mark chooses; the image's health, a marked
  // image refused unless allowMarkedImage is set; the image registry's
  // records, told to the client (the kind, the network flag, the enclave
  // memory and the dApp's minimum operator score, which the runner applies:
  // D138), an image its session name's newest version is not bound to refused
  // with the dApp's current image named; the request's memory need (the
  // image's enclave memory when it is above the client's memory) and its
  // minimum EPC (the image's recorded need, the client's epcMiB and one unit),
  // each told to the client; the class; and the quote at the request's terms.
  // Each refusal is thrown before anything is sent, a registry that does not
  // answer the EPC need's read among them.
  async checkBeforeAdd(imageCid) {
    this.imageCid = imageCid;
    const templateName = this.templateName();
    this.template = await this.chain.template(templateName);
    this.envelope = matching.envelopeFor(this.template);
    if (this.envelope === matching.ENVELOPE_CHUNKED) {
      this.notice(`The template ${templateName} is marked: its trustedzone reads the chunked envelope, which this runner does not write yet; the payload and the input go in the whole-pass format, which that trustedzone reads up to its whole-pass bound.`);
    }
    const health = await this.chain.imageHealth(matching.imageKey(imageCid));
    if (health.marked) {
      const text = `The image ${imageCid} is marked likely broken: in the last 7 days ${health.f7} of its counted orders failed and ${health.s7} succeeded, on ${health.nodes} different nodes and from ${health.owners} different data owners.`;
      if (!this.settings.allowMarkedImage) {
        throw new Error(`${text} The request is not sent; set options.allowMarkedImage to send it, and only operators that opted in answer it.`);
      }
      this.notice(`${text} allowMarkedImage is set: the request is sent.`);
    } else if (health.s7 === 0 && health.f7 === 0) {
      this.notice(`The image ${imageCid} has had no counted order in the last 7 days, so no mark of its health can show.`, ECLog.INFO);
    }
    const found = await this.chain.imageRecords(imageCid);
    this.records = found.records;
    this.dappMinScore = matching.dappMinimum(this.records);
    if (this.records) this.notice(matching.recordsText(imageCid, this.records, found.releaseLanguage), ECLog.INFO);
    if (found.currentImage) {
      throw new Error(`The image ${imageCid} is not the one its session name's newest version is bound to: the dApp's current image is ${found.currentImage}. The request is not sent.`);
    }
    const clientMemory = requestTerms(this.runner.resources).memory;
    this.memoryGb = matching.memoryNeed(clientMemory, this.records);
    if (this.memoryGb > clientMemory) {
      this.notice(`The image ${imageCid} records an enclave memory of ${this.memoryGb} GiB, above the request's memory of ${clientMemory} GB: the request needs ${this.memoryGb} GB.`, ECLog.INFO);
    }
    let imageUnits;
    try {
      imageUnits = await this.chain.imageEpcUnits(imageCid);
    } catch (e) {
      throw new Error(`The image registry did not answer the EPC need of the image ${imageCid} (imageEpcUnits: ${e.shortMessage || e.message}): the request is not sent.`, { cause: e });
    }
    this.epcUnits = matching.minimumEpc(imageUnits, this.settings.epcUnits);
    this.notice(`The request states a minimum EPC of ${this.epcUnits} units of ${matching.EPC_UNIT_MIB} MiB (${this.epcUnits * matching.EPC_UNIT_MIB} MiB): the image records ${imageUnits} and the client gives ${this.settings.epcUnits}.`, ECLog.INFO);
    const defaultRelease = Boolean(this.records && this.records.kind === matching.KIND_DEFAULT_RELEASE);
    this.defaultClass = Boolean(defaultRelease && this.template.marked && !this.runner.isUnsafe()
      && BigInt(found.session) !== 0n && found.latest === found.session);
    if (this.template.marked && !this.defaultClass) {
      const kind = this.records && this.records.kind !== matching.KIND_NONE
        ? ` (${matching.kindText(this.records, found.releaseLanguage)})` : '';
      this.notice(`The image is of the custom class${kind}: a code 20 or 62 of this request is paid to the operator, and the developer and the client carry that risk; the minimum operator score is their protection.`, ECLog.INFO);
      if (this.settings.minScore !== null) {
        const instead = this.dappMinScore !== null
          ? `the dApp's minimum operator score of ${(this.dappMinScore / matching.SCORE_UNITS_PER_POINT).toFixed(4)}`
          : 'the top tier';
        this.notice(`The minimum node score is set to ${(this.settings.minScore / 10000).toFixed(4)} for this request, in place of ${instead}: a 20 or 62 of it is paid to the operator at the client's risk.`);
      }
    }
    await this.quoteBeforeAdd(templateName);
  }

  async quoteBeforeAdd(templateName) {
    const terms = this.requestTerms();
    const word = this.maxGflops();
    const [needGflops, ceilGflops] = matching.needOf(word);
    const minimum = matching.minimumScore({
      explicit: this.settings.minScore,
      dappMinimum: this.dappMinScore,
      defaultClass: this.defaultClass,
      minimumOn: this.defaultClass && await this.chain.minimumOn(),
      tier: 0
    });
    const quote = await this.chain.bidQuoteFor({
      cpu: terms.cpu, memGB: terms.memory, storageGB: terms.storage, bandwidth: terms.bandwidth,
      hours: terms.duration, needGflops, ceilGflops, epcUnits: matching.epcOf(word)
    }, templateName, minimum);
    if (quote.counted === 0 || quote.minBidWei === matching.UINT256_MAX) {
      this.notice('No listed node covers the request\'s resources and template: nobody can claim it at any bid.');
      return;
    }
    const bid = this.settings.terms.maxPricePerCuHourWei;
    this.notice(`The lowest bid at which a listed node matches is ${quote.minBidWei} wei per CU-hour, at the network price of ${quote.baseNowWei}; the request bids ${bid}.`,
      bid >= quote.minBidWei ? ECLog.INFO : ECLog.WARNING);
  }

  // The resources the request is added with (requestTerms), its memory the
  // memory need set before the add.
  requestTerms() {
    const terms = requestTerms(this.runner.resources);
    if (this.memoryGb !== null) terms.memory = this.memoryGb;
    return terms;
  }

  // The V2 add's maxGflops: the minimum EPC set before the add, the required
  // GFLOPS and the ceiling of the terms.
  maxGflops() {
    return matching.maxGflopsArg(this.settings.requiredGflops, Number(this.settings.terms.maxGflops), this.epcUnits || 0);
  }

  // The escrow the add pulls, the reader's escrowFor at the request's terms and
  // `metadata1` (its fields 1 and 2, the image and the template, carry the
  // publishers' fees), told to the client; the wallet's balance against it;
  // and the wallet's allowance for the PoX, raised to the escrow when below
  // it. Resolves the escrow, in wei. Throws, before anything is sent, for an
  // escrow above options.v2.escrowWei and for a wallet below it.
  async checkEscrow(metadata1) {
    const { terms } = this.settings;
    const escrow = await this.chain.escrowFor(this.requestTerms().duration, terms.maxPricePerCuHourWei,
      this.maxGflops(), terms.relaysPerHour, terms.gasLevel, metadata1);
    const wei = escrow.escrowWei;
    if (terms.escrowWei !== null && terms.escrowWei !== undefined && wei > terms.escrowWei) {
      throw new Error(`The request's escrow at its terms is ${wei} wei, above options.v2.escrowWei of ${terms.escrowWei}: the request is not sent.`);
    }
    this.notice(`The request's escrow is ${wei} wei: the work ${escrow.workWei} at ${escrow.escrowGflops} GFLOPS, the fees on it (the publishers' ${escrow.trustedZoneFee} % and ${escrow.secureLockFee} %) and the chain fee ${escrow.chainFeeWei}.`, ECLog.INFO);
    const balance = await this.runner.balanceWei();
    if (balance < wei) {
      throw new Error(`Insufficient wallet balance: the request's escrow is ${wei} wei and the wallet holds ${balance}.`);
    }
    await this.runner.allowWei(wei);
    this.escrowWei = wei;
    return wei;
  }

  // addDORequestV2 with the run's resources, the memory need, the minimum EPC
  // and the V2 terms.
  addRequest(metadata) {
    const { terms } = this.settings;
    return this.chain.addDORequestV2(this.requestTerms(), terms.maxPricePerCuHourWei, this.maxGflops(),
      terms.relaysPerHour, terms.gasLevel, metadata);
  }

  // ------------------------------------------------------- the approval

  // Reads the request at every block and approves a claim by the rule of 3.10,
  // raising the bid by 3.15 when no claim the runner would approve can come;
  // resolves the order the approval placed, or null when `waitSeconds` pass
  // without one. Only a settled read is acted on; a new round or stamp reads
  // the round again. The wait ends with null at once when no parameter set is
  // in force for the request, when it takes no claims now (NoClaimsNow: no
  // longer AVAILABLE, or past maxRequestAgeSeconds), and when its set has
  // claims off, which also sets claimsOff: the request is then served without
  // claims.
  async awaitApproval(doRequestId, waitSeconds) {
    const deadline = Date.now() + waitSeconds * 1000;
    while (this.runner.claimsRunning()) {
      if (Date.now() >= deadline) return null;
      try {
        const order = await this.tick(doRequestId);
        if (order !== null) return order;
      } catch (e) {
        if (e instanceof NoParameterSet || e instanceof NoClaimsNow) {
          this.notice(e.message);
          return null;
        }
        if (e instanceof ClaimsOff) {
          this.claimsOff = true;
          this.notice(e.message);
          return null;
        }
        if (e instanceof matching.StampChanged || e instanceof matching.Unsettled) {
          this.round = null;
        } else {
          this.runner.logAppend(`request ${doRequestId}: a read of the claims failed (${e.message}); read again at the next block`, ECLog.WARNING);
        }
      }
      await delay(this.runner.claimsReadMs());
    }
    return null;
  }

  // The parameter set request `doRequestId` takes, the one its requestInfo
  // `info` names, read once. Throws NoParameterSet when none is in force for
  // it.
  async parameters(doRequestId, info) {
    if (this.params === null) {
      const index = Number(info.parameterSet);
      if (index === matching.NO_PARAMETER_SET) {
        throw new NoParameterSet(`No parameter set of PoxMatching is in force for request ${doRequestId}: it has no schedule, and no claim on it is approved.`);
      }
      this.params = await this.chain.parameterSet(index);
    }
    return this.params;
  }

  async tick(doRequestId) {
    const info = await this.chain.requestInfo(doRequestId);
    if (!info.settled) return null;
    const params = await this.parameters(doRequestId, info);
    if (!info.claims) {
      throw new ClaimsOff(`The parameter set request ${doRequestId} takes has claims off: no claim on it is approved, and it is served without claims (a node places its order and the runner approves it).`);
    }
    const now = await this.chain.chainTime();
    const status = await this.chain.requestStatus(doRequestId);
    if (!matching.takesClaims(info.claims, status, info.createdAt, params.maxRequestAgeSeconds, now)) {
      const age = Number(info.createdAt) + Number(params.maxRequestAgeSeconds);
      const why = status === matching.REQUEST_AVAILABLE
        ? `it is past maxRequestAgeSeconds since ${utc(age)}`
        : `the storage holds it with status ${status}, not AVAILABLE`;
      throw new NoClaimsNow(`Request ${doRequestId} takes no claims now (${why}): no claim on it is approved and its bid is not raised.`);
    }
    const stamp = ethers.hexlify(info.roundStamp);
    if (this.round === null || this.round.stamp !== stamp) this.round = await this.readRound(doRequestId, info);
    let rnd = this.round;
    const { claims, canClaim } = await this.claimsNow(doRequestId, info, rnd);
    const nodes = new Set([...rnd.schedule.mandated, ...claims.keys()]);
    const slotNow = Math.floor((await this.chain.chainTime()) / (await this.chain.slotSeconds()));
    const standings = new Map();
    for (const n of nodes) standings.set(n, await this.standing(n, claims.has(n) || (canClaim.has(n) ? canClaim.get(n) : true)));
    let decision = this.decide(info, rnd, claims, standings, slotNow);
    if (decision.rule === 3 && !rnd.schedule.position.has(decision.approve) && !rnd.whole) {
      this.round = rnd = await this.readBeyond(doRequestId, info, rnd);
      decision = this.decide(info, rnd, claims, standings, slotNow);
    }
    if (decision.approve) return this.approve(doRequestId, decision, claims.get(decision.approve));
    if (decision.wait) return null;
    if (decision.belowMinimum.length) {
      this.noticeOnce(`below|${stamp}`, `Claims of ${decision.belowMinimum.join(', ')} stand below the minimum node score of ${(rnd.minScore / 10000).toFixed(4)}: none is approved, and lowering minNodeScore would approve one.`);
    }
    await this.considerRaise(doRequestId, info, rnd, claims, standings);
    return null;
  }

  decide(info, rnd, claims, standings, slotNow) {
    return matching.decideApproval({
      mandated: rnd.schedule.mandated,
      position: rnd.schedule.position,
      claims,
      standings,
      excluded: rnd.excluded,
      closed: Number(info.closedStep),
      minScore: rnd.minScore,
      recentFailureSlots: this.settings.recentFailureSlots,
      slotNow,
      roundBlock: Number(info.roundBlock),
      stepBlocks: Number(this.params.stepBlocks),
      leadBlocks: Number(this.params.leadBlocks)
    });
  }

  // The round of `info`: its list read from the top of the roll to the end of
  // the stop band, its schedule, the minimum score the runner applies in it
  // and the nodes it excludes. A read whose matching count stayed below
  // maxSteps, or whose stop band is 0, reached the roll's end.
  async readRound(doRequestId, info) {
    const stamp = ethers.hexlify(info.roundStamp);
    const maxSteps = Number(this.params.maxSteps);
    let pages = [];
    let read = { stamp, entries: [], listHash: matching.ZERO_HASH, matchFound: 0, stopBand: 0, done: true };
    let whole = true;
    if (info.ranked) {
      pages = await this.chain.candidatePages(doRequestId, Number(info.round));
      read = matching.mergeCandidates(pages, maxSteps);
      if (read.stamp !== stamp) throw new matching.StampChanged('the list read answered another round stamp than requestInfo');
      whole = read.matchFound < maxSteps || read.stopBand === 0;
    }
    this.hints = hintWords(read.entries);
    return {
      stamp,
      schedule: new matching.Schedule(read.entries, info.seed, maxSteps),
      pages,
      whole,
      minScore: await this.minimum(doRequestId),
      excluded: await this.excluded()
    };
  }

  // The round with the entries below the stop band read on with `beyond` from
  // the last page of its read (4.6), for the order of rule 3.
  async readBeyond(doRequestId, info, rnd) {
    const pages = rnd.pages.concat(await this.chain.candidatePages(doRequestId, Number(info.round), true, rnd.pages[rnd.pages.length - 1]));
    const read = matching.mergeCandidates(pages, Number(this.params.maxSteps));
    if (read.stamp !== rnd.stamp) throw new matching.StampChanged('the read on with beyond answered another round stamp');
    return { ...rnd, schedule: new matching.Schedule(read.entries, info.seed, Number(this.params.maxSteps)), pages, whole: true };
  }

  // The minimum score of the round (3.10 rule 5, D138): the setting, else the
  // dApp's minimum operator score its records hold, else for a dApp of the
  // default class D62's default once minimumOn() answers true, else the top
  // tier of the round.
  async minimum(doRequestId) {
    if (this.settings.minScore !== null) return this.settings.minScore;
    if (this.dappMinScore !== null) return this.dappMinScore;
    if (this.defaultClass) return matching.minimumScore({ defaultClass: true, minimumOn: await this.chain.minimumOn() });
    return matching.minimumScore({ defaultClass: false, tier: await this.chain.tierScore(doRequestId) });
  }

  // The nodes whose claims the runner approves for no request of this image:
  // those of its local list, and for a paid class the nodes of the image's
  // counted failures of the last 7 days, read from each failure's order
  // (3.19).
  async excluded() {
    const now = await this.chain.chainTime();
    const out = new Set(this.runner.localList.nodes(this.imageCid, now));
    if (!this.defaultClass) {
      const failures = matching.recentHealthFailures(await this.chain.healthWords(matching.imageKey(this.imageCid)), now);
      for (const failure of failures) {
        const order = await this.runner.protocolContract.getOrder(failure.orderId);
        out.add(String(order.dproc).toLowerCase());
      }
    }
    return out;
  }

  // Every claim on the request at this read, each { block, approvable,
  // dpRequestId }, and whether each mandated node can still claim
  // (canClaimOf). Throws StampChanged when canClaimOf answers another round
  // stamp.
  async claimsNow(doRequestId, info, rnd) {
    const claims = new Map();
    for (const [node, word, approvable] of await this.chain.claimers(doRequestId, Number(info.claimCount))) {
      const claim = matching.decodeClaim(word);
      if (claim) claims.set(node.toLowerCase(), { block: claim.block, approvable, dpRequestId: claim.dpRequestId });
    }
    const canClaim = new Map();
    if (rnd.schedule.mandated.length) {
      const answer = await this.chain.canClaimOf(doRequestId, rnd.schedule.mandated);
      if (ethers.hexlify(answer.roundStamp) !== rnd.stamp) throw new matching.StampChanged('canClaimOf answered another round stamp');
      rnd.schedule.mandated.forEach((n, i) => canClaim.set(n.toLowerCase(), Boolean(answer.canClaim[i])));
    }
    return { claims, canClaim };
  }

  async standing(node, canAnswer) {
    const { score } = await this.chain.nodeStanding(node);
    return { score, canAnswer: Boolean(canAnswer), lastFailureSlot: await this.chain.lastFailureSlot(node) };
  }

  // The approval of the chosen claim, _placeOrder on its offer, made as a call
  // first: an approval the call refuses (the claim stopped being approvable
  // since the read) is left for the next read.
  async approve(doRequestId, decision, claim) {
    let tx;
    try {
      tx = await this.chain.placeOrder(doRequestId, claim.dpRequestId);
    } catch (e) {
      this.runner.logAppend(`the approval of ${decision.approve}'s claim is refused now (${e.shortMessage || e.message}); read again`, ECLog.INFO);
      return null;
    }
    let receipt;
    try {
      receipt = await this.runner.receiptOf(tx);
    } catch (e) {
      this.runner.logAppend(`the approval ${tx.hash} of ${decision.approve}'s claim did not succeed (${e.shortMessage || e.message}); read again`, ECLog.WARNING);
      return null;
    }
    const order = this.chain.placedOrder(receipt);
    const how = decision.inTime ? 'in its step' : (decision.rule === 1 ? 'late' : 'after the mandates');
    this.notice(`Request ${doRequestId}: the claim of ${decision.approve} was approved by rule ${decision.rule} (${how}); order ${order}.`, ECLog.INFO);
    return order;
  }

  // Rule 4 of 3.10 with the quote over the nodes at or above the round's
  // minimum (D92): a raise within the bid ceiling, followed at the next read
  // by the quote read again (3.15).
  async considerRaise(doRequestId, info, rnd, claims, standings) {
    const quote = matching.mergeQuote(await this.chain.bidQuotePages(doRequestId, rnd.minScore));
    if (quote.stamp !== rnd.stamp) throw new matching.StampChanged('the quote answered another round stamp');
    const counted = [...claims.keys()].filter((n) => !rnd.excluded.has(n) && standings.get(n).score >= rnd.minScore);
    const approvable = counted.filter((n) => claims.get(n).approvable);
    const decision = matching.decideRaise({
      quote,
      claimersCounted: counted.length,
      approvableCounted: approvable.length,
      claimedInRound: Boolean(info.claimedInRound),
      stepNow: Number(info.stepNow),
      maxSteps: Number(this.params.maxSteps),
      round: Number(info.round),
      maxRounds: Number(this.params.maxRounds),
      ceilingWei: this.settings.maxBidWei
    });
    if (decision.action === matching.WAIT) return;
    if (decision.action === matching.REPORT) {
      this.noticeOnce(`raise|${rnd.stamp}|${decision.reason}`, `Request ${doRequestId}: ${decision.reason}.`);
      return;
    }
    await this.runner.allowWei(quote.addedEscrowWei);
    await this.runner.receiptOf(await this.chain.increaseBid(doRequestId, decision.bidWei));
    this.notice(`Request ${doRequestId}: ${decision.reason}; the escrow grows by ${quote.addedEscrowWei} wei.`, ECLog.INFO);
    this.round = null;
  }

  // ------------------------------------------------------- the order

  // { started, fault } of the order's start (section 8 item 9): started once
  // the PoX holds orderStartedAt; while it does not, startTimeoutSeconds (900)
  // after the approval, the order is ended with expireUnstarted, made as a
  // call first, and the fault that resubmits the task is returned. With the
  // setting off nothing is sent. The parameter set is the one requestInfo
  // names for the run's request, read here when no approval read it (a pinned
  // request).
  async startCheck(orderId) {
    if (await this.chain.orderStartedAt(orderId)) return { started: true, fault: null };
    if (!this.settings.expireUnstarted) return { started: false, fault: null };
    const approved = await this.chain.orderApprovedAt(orderId);
    if (this.params === null) {
      const doRequestId = parseInt(this.runner.doRequest, 10);
      await this.parameters(doRequestId, await this.chain.requestInfo(doRequestId));
    }
    const timeout = Number(this.params.startTimeoutSeconds);
    if ((await this.chain.chainTime()) <= approved + timeout) return { started: false, fault: null };
    try {
      await this.runner.receiptOf(await this.chain.expireUnstarted(orderId));
    } catch (e) {
      this.runner.logAppend(`expireUnstarted of order ${orderId} is refused now (${e.shortMessage || e.message})`, ECLog.INFO);
      return { started: false, fault: null };
    }
    this.notice(`The trustedzone of order ${orderId} did not start within ${timeout} s of the approval: the order was ended with expireUnstarted and its escrow returned; the request is added again.`);
    return { started: false, fault: `Order ${orderId} did not start within ${timeout} s of its approval: expireUnstarted ended it and returned its escrow` };
  }

  // Section 8 item 10: an order whose time is up with no result is ended with
  // expireOrder once the PoX admits it, then noteRefund charges its node (the
  // setting noteRefund); one the PoX does not admit yet is kept for
  // runner.settleMatching().
  async expired(orderId) {
    if (await expireOrder(this.chain, this.runner, orderId, this.settings.noteRefund)) return;
    this.runner.matchingPending.push({ kind: 'expire', order: orderId, chain: this.chain, noteRefund: this.settings.noteRefund });
    this.notice(`Order ${orderId} has no result in its time; the PoX admits expireOrder one pricing epoch after its end: settleMatching() sends it then, with noteRefund.`);
  }

  // Section 8 item 16 and 3.19 for an order that closed with a result: a code
  // 33 is judged by PoxMatching's early33, a 33 before its time being settled
  // as a 62; the runner's local list records an end it counts; a code 20, 62,
  // 44, 47, 59 or 63, or a 33 before its time, is reported by the class the
  // result states; and an end noteAmbiguous takes is kept for
  // settleMatching(), which sends it an hour after the result when the
  // members have not.
  async afterResult(orderId, node, code, result) {
    const now = await this.chain.chainTime();
    const early = Number(code) === matching.CODE_TIMEOUT && await this.chain.early33(orderId);
    this.runner.localList.record(this.imageCid, node, code, now, early);
    const report = matching.endReport(code, matching.resultFields(result), early);
    if (report === null) return null;
    this.notice(report.text);
    if (report.ambiguous && this.settings.noteAmbiguous) {
      this.runner.matchingPending.push({
        kind: 'note', order: orderId, chain: this.chain,
        after: (await this.chain.orderResultAt(orderId)) + NOTE_AMBIGUOUS_AFTER_SECONDS, hints: [...this.hints]
      });
    }
    return report;
  }
}

// A request added with V2 terms while it is not served by claims (8.4; OD26):
// on a PoX whose VERSION() takes addDORequestV2 (V2_ADD_ABI), with the escrow
// options.v2.escrowWei states, the wallet's balance checked against it and the
// PoX approved for it, in wei, and the add in the PoX's form. On a "2.0" PoX
// the add states the minimum EPC (matching.minimumEpc of the image's recorded
// need, read from the image registry the network's PoxMatching names when the
// PoX's pricing names one, and the client's epcMiB); the "1.2" form carries
// none. No minimum operator score is read or applied (D196). `chain` is the
// network's MatchingContracts, null when the pricing names no PoxMatching.
export class TermedRequest {
  constructor(runner, version, chain, settings) {
    this.runner = runner;
    this.version = version;
    this.chain = chain;
    this.settings = settings;
    this.epcUnits = 0;
  }

  // Throws, before anything is sent, for a wallet whose balance is below the
  // request's escrow.
  async checkBalance() {
    const { escrowWei } = this.settings.terms;
    const balance = await this.runner.balanceWei();
    if (balance < escrowWei) {
      throw new Error(`Insufficient wallet balance: the request's escrow is ${escrowWei} wei and the wallet holds ${balance}.`);
    }
  }

  // The minimum EPC of the request's image on a "2.0" PoX, told to the
  // client, and the wallet's allowance for the PoX, raised to exactly the
  // escrow when below it. Throws, before anything is sent, when a named image
  // registry does not answer the EPC need's read, and when the approval does
  // not succeed.
  async checkEscrow(imageCid) {
    if (this.version === '2.0') {
      let imageUnits = 0;
      try {
        if (this.chain) imageUnits = await this.chain.imageEpcUnits(imageCid);
      } catch (e) {
        throw new Error(`The image registry did not answer the EPC need of the image ${imageCid} (imageEpcUnits: ${e.shortMessage || e.message}): the request is not sent.`, { cause: e });
      }
      this.epcUnits = matching.minimumEpc(imageUnits, this.settings.epcUnits);
      this.runner.matchingNotice(`The request states a minimum EPC of ${this.epcUnits} units of ${matching.EPC_UNIT_MIB} MiB: the image records ${imageUnits} and the client gives ${this.settings.epcUnits}.`, ECLog.INFO);
    } else if (this.settings.epcUnits) {
      this.runner.matchingNotice(`The PoX answers VERSION() ${this.version}, whose addDORequestV2 states no minimum EPC: options.v2.epcMiB is not sent.`);
    }
    await this.runner.allowWei(this.settings.terms.escrowWei);
  }

  // addDORequestV2 in the PoX's form with the run's resources and V2 terms.
  addRequest(metadata) {
    const { terms, requiredGflops } = this.settings;
    const runner = this.runner;
    return sendV2Add(runner.networkConfig.protocolAddress, runner.protocolContract.getSigner(), this.version,
      requestTerms(runner.resources), terms.maxPricePerCuHourWei,
      matching.maxGflopsArg(requiredGflops, Number(terms.maxGflops), this.epcUnits), terms.relaysPerHour, terms.gasLevel,
      metadata);
  }
}
