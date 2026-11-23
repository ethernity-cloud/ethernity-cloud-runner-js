// A request served by claims (MATCHING-DESIGN.md section 8): the checks before
// its V2 add, the approval of a claim by the rule of 3.10, the raise of 3.15,
// the order that does not start (expireUnstarted) or expires (expireOrder and
// noteRefund), the report of its end by class and the noteAmbiguous the
// members have not sent (3.16, 3.19).
//
// EthernityCloudRunner builds a ClaimsPath for a request on a network whose
// descriptor names PoxMatching and its reader when claimsOn() answers true
// before the add; on every other network, and while claims are off, it serves
// the request as it did before (8.4).
import { ethers } from 'ethers';
import * as matching from './matching.js';
import { requestTerms } from './contract/operation/requestTerms.js';
import { delay } from './utils.js';
import { ECLog } from './enums.js';

// How long after an order's result the runner sends noteAmbiguous itself when
// the validators' members have not (section 8 item 16).
export const NOTE_AMBIGUOUS_AFTER_SECONDS = 3600;
// The number of matching nodes of the approval's round a noteAmbiguous names
// as its hints, the proof that three nodes could serve the request (3.19).
const HINT_NODES = 3;

// The settings a request served by claims reads (section 8 items 1, 5, 6, 9,
// 10, 12 and 16): the V2 terms of options.v2 (runner.v2TermsOf) with their
// requiredGflops (0: one CU, D38) and maxBidPerCuHourWei, the bid ceiling a
// raise stays within (none: the quote is reported and nothing is raised), and
// of `options` minNodeScore (points, 0.50; 0 switches the test off),
// recentFailureSlots, allowMarkedImage, expireUnstarted, noteRefund and
// noteAmbiguous. Throws, before anything is sent, for a request without V2
// terms and for a setting out of its range.
export const claimsSettings = (v2Terms, v2, options = {}) => {
  if (!v2Terms) {
    throw new Error('This network serves DO requests by claims (PoxMatching\'s claimsOn() is true), so a request is added with V2 terms: pass options.v2 with maxPricePerCuHourWei and escrowWei.');
  }
  const whole = (value, name, fallback) => {
    if (value === undefined || value === null) return fallback;
    const parsed = typeof value === 'bigint' ? value : (/^\d+$/.test(String(value).trim()) ? BigInt(String(value).trim()) : null);
    if (parsed === null) throw new TypeError(`${name} must be a whole number of 0 or more`);
    return parsed;
  };
  return {
    terms: v2Terms,
    requiredGflops: Number(whole(v2 && v2.requiredGflops, 'options.v2.requiredGflops', 0n)),
    maxBidWei: whole(v2 && v2.maxBidPerCuHourWei, 'options.v2.maxBidPerCuHourWei', null),
    minScore: options.minNodeScore === undefined || options.minNodeScore === null ? null : matching.scoreUnits(options.minNodeScore),
    recentFailureSlots: Number(whole(options.recentFailureSlots, 'options.recentFailureSlots', BigInt(matching.DEFAULT_RECENT_FAILURE_SLOTS))),
    allowMarkedImage: Boolean(options.allowMarkedImage),
    expireUnstarted: options.expireUnstarted !== false,
    noteRefund: options.noteRefund !== false,
    noteAmbiguous: options.noteAmbiguous !== false
  };
};

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
// `noteRefund`; false when the PoX does not admit the expiry yet.
export const expireOrder = async (chain, runner, orderId, noteRefund) => {
  try {
    const tx = await chain.expireOrder(orderId);
    await tx.wait();
  } catch (e) {
    return false;
  }
  runner.matchingNotice(`Order ${orderId} had no result in its time and was expired: its escrow is returned.`);
  if (noteRefund) {
    try {
      await (await chain.noteRefund(orderId)).wait();
      runner.matchingNotice(`noteRefund recorded order ${orderId}'s expiry against its node.`, ECLog.INFO);
    } catch (e) {
      runner.matchingNotice(`noteRefund of order ${orderId} is refused: ${e.shortMessage || e.message}`, ECLog.INFO);
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
      await (await chain.noteAmbiguous(item.order, item.hints)).wait();
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
    this.params = null;
    this.round = null;
    this.hints = [];
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

  // The reads before the add (8.1, 8.12, 8.13, 3.19): the template's record
  // and the envelope its mark chooses; the image's health, a marked image
  // refused unless allowMarkedImage is set; the image registry's records, an
  // image its session name's newest version is not bound to refused with the
  // dApp's current image named; the class; and the quote at the request's
  // terms. Each refusal is thrown before anything is sent.
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
    const records = await this.chain.imageRecords(imageCid);
    if (records.currentImage) {
      throw new Error(`The image ${imageCid} is not the one its session name's newest version is bound to: the dApp's current image is ${records.currentImage}. The request is not sent.`);
    }
    this.defaultClass = Boolean(records.defaultRelease && this.template.marked && !this.runner.isUnsafe()
      && BigInt(records.session) !== 0n && records.latest === records.session);
    if (this.template.marked && !this.defaultClass) {
      this.notice('The image is of the custom class: a code 20 or 62 of this request is paid to the operator, and the developer and the client carry that risk; the minimum operator score is their protection.', ECLog.INFO);
      if (this.settings.minScore !== null) {
        this.notice(`The minimum node score is set to ${(this.settings.minScore / 10000).toFixed(4)} for this request, in place of the top tier: a 20 or 62 of it is paid to the operator at the client's risk.`);
      }
    }
    await this.quoteBeforeAdd(templateName);
  }

  async quoteBeforeAdd(templateName) {
    const terms = requestTerms(this.runner.resources);
    const [needGflops, ceilGflops] = matching.needOf(this.maxGflops());
    const minimum = matching.minimumScore({
      explicit: this.settings.minScore,
      defaultClass: this.defaultClass,
      minimumOn: this.defaultClass && await this.chain.minimumOn(),
      tier: 0
    });
    const quote = await this.chain.bidQuoteFor({
      cpu: terms.cpu, memGB: terms.memory, storageGB: terms.storage, bandwidth: terms.bandwidth,
      hours: terms.duration, needGflops, ceilGflops
    }, templateName, minimum);
    if (quote.counted === 0 || quote.minBidWei === matching.UINT256_MAX) {
      this.notice('No listed node covers the request\'s resources and template: nobody can claim it at any bid.');
      return;
    }
    const bid = this.settings.terms.maxPricePerCuHourWei;
    this.notice(`The lowest bid at which a listed node matches is ${quote.minBidWei} wei per CU-hour, at the network price of ${quote.baseNowWei}; the request bids ${bid}.`,
      bid >= quote.minBidWei ? ECLog.INFO : ECLog.WARNING);
  }

  // The V2 add's maxGflops: the required GFLOPS and the ceiling of the terms.
  maxGflops() {
    return matching.maxGflopsArg(this.settings.requiredGflops, Number(this.settings.terms.maxGflops));
  }

  // addDORequestV2 with the run's resources and V2 terms.
  addRequest(metadata) {
    const { terms } = this.settings;
    return this.chain.addDORequestV2(requestTerms(this.runner.resources), terms.maxPricePerCuHourWei,
      this.maxGflops(), terms.relaysPerHour, terms.gasLevel, metadata);
  }

  // ------------------------------------------------------- the approval

  // Reads the request at every block and approves a claim by the rule of 3.10,
  // raising the bid by 3.15 when no claim the runner would approve can come;
  // resolves the order the approval placed, or null when `waitSeconds` pass
  // without one. Only a settled read is acted on; a new round or stamp reads
  // the round again.
  async awaitApproval(doRequestId, waitSeconds) {
    const deadline = Date.now() + waitSeconds * 1000;
    while (this.runner.claimsRunning()) {
      if (Date.now() >= deadline) return null;
      try {
        const order = await this.tick(doRequestId);
        if (order !== null) return order;
      } catch (e) {
        if (e instanceof matching.StampChanged || e instanceof matching.Unsettled) {
          this.round = null;
        } else {
          this.runner.logAppend(`request ${doRequestId}: a read of the claims failed (${e.message}); read again at the next block`, ECLog.WARNING);
        }
      }
      await delay(this.runner.claimsPollMs);
    }
    return null;
  }

  async tick(doRequestId) {
    const info = await this.chain.requestInfo(doRequestId);
    if (!info.settled) return null;
    if (this.params === null) this.params = await this.chain.requestParameters(doRequestId);
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
      read = matching.mergeCandidates(pages, Number(this.params.bandWidth), maxSteps);
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
    const read = matching.mergeCandidates(pages, Number(this.params.bandWidth), Number(this.params.maxSteps));
    if (read.stamp !== rnd.stamp) throw new matching.StampChanged('the read on with beyond answered another round stamp');
    return { ...rnd, schedule: new matching.Schedule(read.entries, info.seed, Number(this.params.maxSteps)), pages, whole: true };
  }

  // The minimum score of the round (3.10 rule 5, D138): the setting, else for
  // a dApp of the default class D62's default once minimumOn() answers true,
  // else the top tier of the round.
  async minimum(doRequestId) {
    if (this.settings.minScore !== null) return this.settings.minScore;
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
  // (scheduleOf's canClaim).
  async claimsNow(doRequestId, info, rnd) {
    const claims = new Map();
    for (const [node, word, approvable] of await this.chain.claimers(doRequestId, Number(info.claimCount))) {
      const claim = matching.decodeClaim(word);
      if (claim) claims.set(node.toLowerCase(), { block: claim.block, approvable, dpRequestId: claim.dpRequestId });
    }
    const canClaim = new Map();
    if (rnd.schedule.mandated.length) {
      const schedule = await this.chain.scheduleOf(doRequestId);
      if (ethers.hexlify(schedule.roundStamp) === rnd.stamp && schedule.complete) {
        schedule.mandated.forEach((n, i) => canClaim.set(n.toLowerCase(), Boolean(schedule.canClaim[i])));
      }
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
    let receipt;
    try {
      receipt = await (await this.chain.placeOrder(doRequestId, claim.dpRequestId)).wait();
    } catch (e) {
      this.runner.logAppend(`the approval of ${decision.approve}'s claim is refused now (${e.shortMessage || e.message}); read again`, ECLog.INFO);
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
    await (await this.chain.increaseBid(doRequestId, decision.bidWei)).wait();
    this.notice(`Request ${doRequestId}: ${decision.reason}; the escrow grows by ${quote.addedEscrowWei} wei.`, ECLog.INFO);
    this.round = null;
  }

  // ------------------------------------------------------- the order

  // { started, fault } of the order's start (section 8 item 9): started once
  // the PoX holds orderStartedAt; while it does not, startTimeoutSeconds (900)
  // after the approval, the order is ended with expireUnstarted, made as a
  // call first, and the fault that resubmits the task is returned. With the
  // setting off nothing is sent.
  async startCheck(orderId) {
    if (await this.chain.orderStartedAt(orderId)) return { started: true, fault: null };
    if (!this.settings.expireUnstarted) return { started: false, fault: null };
    const approved = await this.chain.orderApprovedAt(orderId);
    const timeout = Number(this.params.startTimeoutSeconds);
    if ((await this.chain.chainTime()) <= approved + timeout) return { started: false, fault: null };
    try {
      await (await this.chain.expireUnstarted(orderId)).wait();
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

  // Section 8 item 16 and 3.19 for an order that closed with a result: the
  // runner's local list records an end it counts, a code 20, 62, 44, 47, 59 or
  // 63 is reported by the class the result states, and an end noteAmbiguous
  // takes is kept for settleMatching(), which sends it an hour after the
  // result when the members have not.
  async afterResult(orderId, node, code, result) {
    const now = await this.chain.chainTime();
    this.runner.localList.record(this.imageCid, node, code, now);
    const report = matching.endReport(code, matching.resultFields(result));
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
