import { ethers } from 'ethers';
import {
  imageRegistry as imageRegistryAbi, matching as matchingAbi, pox as poxAbi, reader as readerAbi,
  sessionRegistry as sessionRegistryAbi
} from '../abi/matchingAbi.js';
import { KIND_DEFAULT_RELEASE, decodeTemplate, templateKey } from '../../matching.js';
import { withGasHeadroom } from '../../utils.js';

// The roll entries one paged read of the reader asks for (`count` of
// candidates, bidQuote, bidQuoteFor and tierScore) where the network names no
// page: bloxberg's, the smallest of the callers' pages (spec/matching.md
// section 2: 650 on bloxberg, 800 on Polygon and Amoy, 1,450 on LitVM).
export const DEFAULT_PAGE_ENTRIES = 650;
// The claimers one claimersOf call reads.
const CLAIMERS_PAGE = 100;
const ZERO_BYTES32 = ethers.ZeroHash;

// The named answers of an ethers Result as a plain object.
const named = (result) => result.toObject();

// A bigint of a struct's or a view's answers as a Number when it is a safe
// integer.
const plain = (value) => (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value);

// The PoX 2.0 contracts of a network with matching, as a runner reads and
// sends to them (MATCHING-DESIGN.md section 8): the PoX at `poxAddress`,
// PoxMatching at `matchingAddress` and PoxMatchReader at the address
// PoxMatching's reader() answers (bindReader), on the wallet's provider and
// signer. Every transaction is first made as a call from the runner's wallet
// (staticCall) and sent only when the call passes; a call that reverts throws
// what the provider threw and nothing is sent.
class MatchingContracts {
  constructor(poxAddress, matchingAddress, provider, signer, pageEntries) {
    this.provider = provider;
    this.pox = new ethers.Contract(poxAddress, poxAbi, signer);
    this.matching = new ethers.Contract(matchingAddress, matchingAbi, signer);
    this.reader = null;
    this.pageEntries = BigInt(pageEntries || DEFAULT_PAGE_ENTRIES);
  }

  // Binds the PoxMatchReader PoxMatching names (reader(), written once by its
  // owner) and resolves its address. Throws while PoxMatching names none.
  async bindReader() {
    const address = await this.matching.reader();
    if (BigInt(address) === 0n) {
      throw new Error(`PoxMatching ${this.matching.target} names no PoxMatchReader (reader() is zero): a request cannot be served by claims on this network yet, and none is sent.`);
    }
    this.reader = new ethers.Contract(address, readerAbi, this.provider);
    return address;
  }

  async send(contract, name, args) {
    await contract[name].staticCall(...args);
    return withGasHeadroom(contract[name], args);
  }

  // ------------------------------------------------------------- sends

  // addDORequestV2 with `terms` (requestTerms) of the resources, one instance,
  // the bid per CU-hour, the maxGflops argument (the required GFLOPS and the
  // ceiling), the chain fee's relays per hour and gas level, and the four
  // metadata strings.
  addDORequestV2(terms, bidWei, maxGflops, relaysPerHour, gasLevel, metadata) {
    return this.send(this.pox, 'addDORequestV2', [terms.cpu, terms.memory, terms.storage, terms.bandwidth,
      terms.duration, 1, bidWei, maxGflops, relaysPerHour, gasLevel, ...metadata]);
  }

  // The approval of a claim: _placeOrder from the data owner on the claim's
  // offer (3.10).
  placeOrder(doRequestId, dpRequestId) {
    return this.send(this.pox, '_placeOrder', [doRequestId, dpRequestId]);
  }

  increaseBid(doRequestId, bidWei) {
    return this.send(this.pox, 'increaseBid', [doRequestId, bidWei]);
  }

  expireUnstarted(orderId) {
    return this.send(this.pox, 'expireUnstarted', [orderId]);
  }

  expireOrder(orderId) {
    return this.send(this.pox, 'expireOrder', [orderId]);
  }

  noteRefund(orderId) {
    return this.send(this.matching, 'noteRefund', [orderId]);
  }

  noteAmbiguous(orderId, hints) {
    return this.send(this.matching, 'noteAmbiguous', [orderId, hints]);
  }

  // The order id the _orderPlacedEV of a mined approval names, or null.
  placedOrder(receipt) {
    const target = String(this.pox.target).toLowerCase();
    for (const log of receipt.logs) {
      if (String(log.address).toLowerCase() !== target) continue;
      try {
        const parsed = this.pox.interface.parseLog(log);
        if (parsed && parsed.name === '_orderPlacedEV') return Number(parsed.args._orderNumber);
      } catch (e) {
        // A log of another event of the PoX.
      }
    }
    return null;
  }

  // ------------------------------------------------------------- reads

  async claimsOn() { return Boolean(await this.matching.claimsOn()); }

  async minimumOn() { return Boolean(await this.matching.minimumOn()); }

  async slotSeconds() { return Number(await this.matching.slotSeconds()); }

  // { score, beatAgeSlots, bannedUntil } of `node`.
  async nodeStanding(node) {
    const [score, beatAgeSlots, bannedUntil] = await this.matching.nodeStanding(node);
    return { score: Number(score), beatAgeSlots: Number(beatAgeSlots), bannedUntil: Number(bannedUntil) };
  }

  async lastFailureSlot(node) { return Number((await this.matching.recordOf(node)).lastFailureSlot); }

  // { s7, f7, nodes, owners, marked } of the image key `image`.
  async imageHealth(image) {
    const [s7, f7, nodes, owners, marked] = await this.matching.imageHealth(image);
    return { s7: Number(s7), f7: Number(f7), nodes: Number(nodes), owners: Number(owners), marked: Boolean(marked) };
  }

  async healthWords(image) { return [...(await this.matching.healthOf(image))].map(BigInt); }

  async template(name) {
    const [word] = await this.matching.templateOf(templateKey(name));
    return decodeTemplate(word);
  }

  // PoxMatching's parameter set `index`, by field name.
  async parameterSet(index) {
    const set = await this.matching.parameterSet(index);
    return Object.fromEntries(Object.entries(set.toObject()).map(([k, v]) => [k, plain(v)]));
  }

  // Whether a code 33 in the order's stored result is a timeout before its
  // time on its template's constants, as PoxMatching judges it.
  async early33(orderId) { return Boolean(await this.matching.early33(orderId)); }

  // requestInfo by field name; `parameterSet` is the index of the set the
  // request takes, NO_PARAMETER_SET (256) when none is in force.
  async requestInfo(doRequestId) { return named(await this.reader.requestInfo(doRequestId)); }

  // { roundStamp, canClaim } of `nodes` at the request's current round:
  // whether each can still claim it, as scheduleOf's canClaim answers it for
  // the mandated nodes.
  async canClaimOf(doRequestId, nodes) {
    const [roundStamp, canClaim] = await this.reader.canClaimOf(doRequestId, nodes);
    return { roundStamp: ethers.hexlify(roundStamp), canClaim: [...canClaim].map(Boolean) };
  }

  // What addDORequestV2 pulls for these terms in the latest block, by field
  // name: escrowWei, its work part workWei at escrowGflops, chainFeeWei, and
  // the publishers' fee percents trustedZoneFee and secureLockFee that
  // `metadata1` (fields 1 and 2) carries.
  async escrowFor(hours, bidWei, maxGflops, relaysPerHour, gasLevel, metadata1) {
    const e = named(await this.reader.escrowFor(hours, bidWei, maxGflops, relaysPerHour, gasLevel, metadata1));
    return {
      escrowWei: BigInt(e.escrowWei),
      workWei: BigInt(e.workWei),
      chainFeeWei: BigInt(e.chainFeeWei),
      escrowGflops: Number(e.escrowGflops),
      trustedZoneFee: Number(e.trustedZoneFee),
      secureLockFee: Number(e.secureLockFee)
    };
  }

  // The `candidates` pages of one read of round `round`: from the top of the
  // roll, or with `beyond` set on from the last page of `start`, a read without
  // it, to the roll's end. A read without `beyond` ends at the end of the stop
  // band.
  async candidatePages(doRequestId, round, beyond = false, start = null) {
    let band = 49;
    let index = 0n;
    let h = ZERO_BYTES32;
    let found = 0;
    if (start) ({ nextBand: band, nextFrom: index, hOut: h, matchFoundOut: found } = start);
    const pages = [];
    for (;;) {
      const page = named(await this.reader.candidates(doRequestId, round, band, index, this.pageEntries, h, found, beyond));
      pages.push(page);
      if (page.done) return pages;
      ({ nextBand: band, nextFrom: index, hOut: h, matchFoundOut: found } = page);
    }
  }

  // [node, claim word, approvable] of the request's first `count` claimers, in
  // the order of their claims.
  async claimers(doRequestId, count) {
    const found = [];
    while (found.length < count) {
      const [nodes, claims, approvable] = await this.reader.claimersOf(doRequestId, found.length,
        Math.min(CLAIMERS_PAGE, count - found.length));
      if (!nodes.length) break;
      nodes.forEach((node, i) => found.push([node, BigInt(claims[i]), Boolean(approvable[i])]));
    }
    return found;
  }

  // The bidQuote pages over the nodes at or above `minScore` (D92), each page
  // carrying the lowest bid the pages before it found.
  async bidQuotePages(doRequestId, minScore) {
    let band = 49;
    let index = 0n;
    let carry = 0n;
    const pages = [];
    for (;;) {
      const page = named(await this.reader.bidQuote(doRequestId, minScore, band, index, this.pageEntries, carry));
      pages.push(page);
      if (page.done) return pages;
      ({ nextBand: band, nextFrom: index, minBidWei: carry } = page);
    }
  }

  // bidQuoteFor over its pages for the terms of a request about to be added:
  // { counted, minBidWei, baseNowWei }, minBidWei 2^256 - 1 when no node was
  // counted, at the network price of the read.
  async bidQuoteFor(terms, templateName, minScore) {
    let band = 49;
    let index = 0n;
    let carry = 0n;
    let counted = 0;
    for (;;) {
      const page = named(await this.reader.bidQuoteFor(terms.cpu, terms.memGB, terms.storageGB, terms.bandwidth,
        terms.hours, terms.needGflops, terms.ceilGflops, templateKey(templateName), minScore, band, index,
        this.pageEntries, carry));
      counted += Number(page.counted);
      if (page.done) return { counted, minBidWei: BigInt(page.minBidWei), baseNowWei: BigInt(page.baseNowWei) };
      ({ nextBand: band, nextFrom: index, minBidWei: carry } = page);
    }
  }

  // The top quarter's boundary of the request's round (D138, D152), tierScore
  // paged over its two passes.
  async tierScore(doRequestId) {
    let band = 49;
    let index = 0n;
    let carry = [0n, 0n, 0n, 0n, 0n, 0n, 0n];
    for (;;) {
      const [score, carryOut, nextBand, nextFrom, done] = await this.reader.tierScore(doRequestId, band, index,
        this.pageEntries, carry);
      if (done) return Number(score);
      [carry, band, index] = [[...carryOut], nextBand, nextFrom];
    }
  }

  // The timestamp of the latest block.
  async chainTime() { return Number((await this.provider.getBlock('latest')).timestamp); }

  async orderApprovedAt(orderId) { return Number(await this.pox.orderApprovedAt(orderId)); }

  async orderStartedAt(orderId) { return Number(await this.pox.orderStartedAt(orderId)); }

  async orderResultAt(orderId) { return Number((await this.pox.orderResultAt(orderId))[0]); }

  // Whether noteAmbiguous has marked the order: PoxMatching's record of it is
  // noted (bit 0 of ambiguousOf's word).
  async orderMarked(orderId) { return (BigInt(await this.matching.ambiguousOf(orderId)) & 255n) !== 0n; }

  // What the image registry PoxMatching names (ECImageRegistryV4) and its
  // SessionRegistry hold for the securelock image `imageCid`: `registry`
  // (null when PoxMatching names none), `records` (imageRecords: { kind,
  // release, networkOn, enclaveMemoryGiB, minScoreSet, minScore }, null
  // without a registry), `releaseLanguage` (the language of the default
  // release kind 1 records name, else null), the session it is bound to
  // (`session`, zero for none), the newest version of that session's name
  // (`latest`) and the image that version is bound to (`currentImage`).
  async imageRecords(imageCid) {
    const found = { registry: null, records: null, releaseLanguage: null, session: ZERO_BYTES32, latest: ZERO_BYTES32, currentImage: null };
    const registry = await this.matching.imageRegistry();
    if (BigInt(registry) === 0n) return found;
    found.registry = registry;
    const images = new ethers.Contract(registry, imageRegistryAbi, this.provider);
    const held = (await images.imageRecords(imageCid)).toObject();
    found.records = {
      kind: Number(held.kind),
      release: Number(held.release),
      networkOn: Boolean(held.networkOn),
      enclaveMemoryGiB: Number(held.enclaveMemoryGiB),
      minScoreSet: Boolean(held.minScoreSet),
      minScore: Number(held.minScore)
    };
    if (found.records.kind === KIND_DEFAULT_RELEASE) {
      found.releaseLanguage = Number((await images.defaultRelease(found.records.release)).language);
    }
    const sessionsAddress = await images.sessionRegistry();
    if (BigInt(sessionsAddress) === 0n) return found;
    const sessions = new ethers.Contract(sessionsAddress, sessionRegistryAbi, this.provider);
    found.session = await sessions.sessionOfImage(imageCid);
    if (BigInt(found.session) === 0n) return found;
    const { enclaveName } = await sessions.record(found.session);
    found.latest = await sessions.latest(enclaveName);
    if (found.latest !== found.session && BigInt(found.latest) !== 0n) {
      found.currentImage = (await sessions.record(found.latest)).imageCid;
    }
    return found;
  }
}

export default MatchingContracts;
