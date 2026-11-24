// spec/runner-terms.json (SF21; the copy in test/fixtures/) replayed through
// the runner's own request path: each case's settings are a run's resources
// and options, the PoX answers the case's VERSION() and its pricing the case's
// matching() (MATCHING with claims on, the zero address with claims off), the
// pricing's bounds are the file's (gflopsMax 6,400, maxOrderHours 168) and
// the image registry records the case's imageEpcUnits; the runner takes the
// settings (selectRequestTerms), chooses the path (prepareRequest), checks the
// balance and the allowance and adds the request (createDORequest), as
// processTaskAttempt does, with metadata of the case's sizes. A case either
// names the add (its selector, the form of maxGflops and the arguments,
// decoded from the addDORequestV2 sendV2Add sends), its minimum EPC, the order
// of the sends, whether the claims path is taken, whether a score test (a
// quote with a minimum score above 0) precedes the add and the score units of
// the setting; or names a refusal, thrown with a message that holds the
// case's message before anything is sent. A metadata bound is tested after
// the approval (D206), so a metadata refusal follows the approval and no add
// is sent. runner-terms-reads.json, which both runners hold byte for byte,
// names the quote and the escrow each adding case reads before its add (none
// off the claims path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ClaimsPath } from '../claims.js';
import * as matching from '../matching.js';
import { ECAddress } from '../enums.js';
import { V2_ADD_ABI, sendV2Add } from '../contract/operation/matchingContract.js';
import { load } from './specCopies.js';

const TERMS = load('runner-terms.json');
const READS = JSON.parse(readFileSync(new URL('./runner-terms-reads.json', import.meta.url), 'utf8'));
const TOKEN = ECAddress.BLOXBERG.TESTNET_ADDRESS;
const POX = ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS;
const WALLET = '0xF79648481c486406F0872401bDCfdA2d6152a6E1';
const PRICING = `0x${'0c'.repeat(20)}`;
const MATCHING = `0x${'01'.repeat(20)}`;
const IMAGE = 'QmMatchingImageA';
const TEMPLATE = 'ecld-nodenithy-matching';
const APPROVAL = 'token.approve(pox, escrowWei)';
const ADD = 'addDORequestV2';
const BOUNDS = { gflopsMax: TERMS.rules.bounds.gflopsMax, maxOrderHours: TERMS.rules.bounds.maxOrderHours };
const METADATA_REFUSALS = new Set(['metadata1 too long', 'metadata too long']);
const FORMS = Object.values(V2_ADD_ABI).map((abi) => new ethers.Interface(abi));

// The runner's signer: the add's call answers request 5, its estimate and its
// send are kept; `sends` holds the sends in order.
const signerOf = (sends, added) => ({
  getAddress: async () => WALLET,
  call: async () => ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [5]),
  estimateGas: async () => 400000n,
  sendTransaction: async (tx) => { sends.push(ADD); added.push(tx.data); return { hash: '0xadd' }; }
});

// The network's MatchingContracts as the claims path calls it: claimsOn() as
// the case states, the image's recorded EPC need, no records, the quote and
// the escrow kept, and the add sent through sendV2Add on the runner's signer.
const chainOf = (settings, signer, version) => ({
  claimsOnReads: 0,
  quotes: [],
  escrows: [],
  async claimsOn() { this.claimsOnReads += 1; return settings.claims; },
  async bindReader() { return `0x${'02'.repeat(20)}`; },
  async template() { return matching.decodeTemplate(0n); },
  async imageHealth() { return { s7: 0, f7: 0, nodes: 0, owners: 0, marked: false }; },
  async imageRecords() {
    return { registry: null, records: null, releaseLanguage: null, session: ethers.ZeroHash, latest: ethers.ZeroHash, currentImage: null };
  },
  async imageEpcUnits() { return settings.imageEpcUnits || 0; },
  async minimumOn() { return false; },
  async bidQuoteFor(terms, templateName, minScore) {
    this.quotes.push([terms, templateName, minScore]);
    return { counted: 5, minBidWei: 7n * 10n ** 17n, baseNowWei: 6n * 10n ** 17n };
  },
  async escrowFor(...args) {
    this.escrows.push(args);
    return { escrowWei: 2n * 10n ** 18n, workWei: 0n, chainFeeWei: 0n, escrowGflops: 0, trustedZoneFee: 0, secureLockFee: 0 };
  },
  addDORequestV2(terms, bidWei, maxGflops, relaysPerHour, gasLevel, metadata) {
    return sendV2Add(POX, signer, version, terms, bidWei, maxGflops, relaysPerHour, gasLevel, metadata);
  }
});

// The protocol contract: the signer, and a mined receipt of request 4349.
const protocolOf = (signer) => ({
  getSigner: () => signer,
  getContract: () => ({
    _getOrdersCount: async () => 21n,
    removeAllListeners: async () => {},
    interface: { parseLog: () => ({ name: '_addDORequestEV', args: [WALLET, 4349n] }) }
  }),
  getProvider: () => ({ send: async () => ({ status: '0x1', blockNumber: '0x1', logs: [{ topics: [], data: '0x' }] }) })
});

// A run's resources and options for a case's settings (runner-terms.json
// `settings`).
const runOf = (s) => {
  const resources = { cpu: s.cpu, memory: s.mem, storage: s.storageGB, bandwidth: s.bw, duration: s.hours, validators: s.instances };
  const v2 = { maxPricePerCuHourWei: BigInt(s.bid), escrowWei: 10n ** 40n };
  if (s.ceilGflops !== undefined) v2.maxGflops = s.ceilGflops;
  if (s.needGflops !== undefined) v2.requiredGflops = s.needGflops;
  if (s.clientEpcMiB !== undefined) v2.epcMiB = s.clientEpcMiB;
  if (s.relaysPerHour !== undefined) v2.relaysPerHour = s.relaysPerHour;
  if (s.gasLevel !== undefined) v2.gasLevel = BigInt(s.gasLevel);
  const options = { v2 };
  if (s.minScore !== undefined) options.minNodeScore = s.minScore;
  return { resources, options };
};

// The runner's request path for `c`: { runner, sends, added, chain, refusal }.
const replay = async (c) => {
  const s = c.settings;
  const sends = [];
  const added = [];
  const signer = signerOf(sends, added);
  const runner = new EthernityCloudRunner(TOKEN, {
    provider: { getNetwork: async () => ({ chainId: 8995n }) }, signer: { getAddress: async () => WALLET }
  });
  runner.dispatchECEvent = () => {};
  await runner.resolveNetworkContext();
  const generation = { version: s.version, matchingAddress: s.matching === 'set' ? MATCHING : ethers.ZeroAddress, pricingAddress: PRICING };
  runner.readPoxGeneration = async () => generation;
  runner.readTermBounds = async () => BOUNDS;
  let chain = null;
  runner.matchingContracts = (cfg, g) => { chain = chainOf(s, signer, g.version); return chain; };
  runner.protocolContract = protocolOf(signer);
  runner.balanceWei = async () => 10n ** 40n;
  runner.allowWei = async () => { sends.push(APPROVAL); };
  runner.resolveTrustedZoneImage = () => TEMPLATE;
  runner.enclaveImageIPFSHash = IMAGE;
  runner.requestedNodeAddress = '';
  const { resources, options } = runOf(s);
  runner.resources = resources;
  runner.runOptions = options;
  try {
    runner.selectRequestTerms(options.v2);
    await runner.prepareRequest();
    await runner.checkWalletBalance();
    await runner.checkAllowance();
    await runner.createDORequest('i'.repeat(s.metadata1Bytes), 'c'.repeat(s.metadataBytes), 'n'.repeat(s.metadataBytes));
  } catch (refusal) {
    return { runner, sends, added, chain, refusal };
  }
  return { runner, sends, added, chain, refusal: null };
};

// [selector, fragment, args by name] of the add's calldata.
const decodeAdd = (data) => {
  const selector = data.slice(0, 10);
  const iface = FORMS.find((i) => i.getFunction(selector));
  const fragment = iface.getFunction(selector);
  const values = iface.decodeFunctionData(fragment, data);
  return [selector, fragment, Object.fromEntries(fragment.inputs.map((input, i) => [input.name, values[i]]))];
};

for (const c of TERMS.cases) {
  test(`runner-terms.json: ${c.name}`, async () => {
    const { runner, sends, added, chain, refusal } = await replay(c);
    const expected = c.expected;
    if (expected.refused) {
      assert.ok(refusal, 'the request was not refused');
      assert.ok(refusal.message.includes(expected.refused.message), refusal.message);
      assert.deepEqual(added, []);
      assert.deepEqual(sends, METADATA_REFUSALS.has(expected.refused.message) ? [APPROVAL] : []);
      return;
    }
    assert.equal(refusal, null, refusal && refusal.message);
    const [selector, fragment, args] = decodeAdd(added[0]);
    assert.equal(selector, expected.add.selector);
    assert.equal(`maxGflops ${fragment.inputs.find((i) => i.name === 'maxGflops').type}`, expected.add.form);
    assert.deepEqual(Object.fromEntries(Object.entries(expected.add.args).map(([name, value]) => [name,
      typeof value === 'string' ? args[name].toString() : Number(args[name])])), expected.add.args);
    assert.equal(Number(BigInt(args.maxGflops) >> 32n), expected.epcUnits);
    assert.deepEqual(sends, expected.sends);
    assert.deepEqual(sends, [APPROVAL, ADD]);
    assert.equal(runner.claims instanceof ClaimsPath, expected.claimsPath);
    assert.equal((runner.claims || runner.termed).settings.minScore, expected.minScoreUnits);
    const quotes = chain ? chain.quotes : [];
    assert.equal(quotes.some(([, , minimum]) => minimum > 0), expected.scoreTestBeforeAdd);
    const reads = READS.cases[c.name];
    if (reads.quote === null) {
      assert.deepEqual(quotes, []);
      assert.deepEqual(chain ? chain.escrows : [], []);
      return;
    }
    const { template, minScore, ...quote } = reads.quote;
    assert.deepEqual(quotes, [[quote, template, minScore]]);
    const e = reads.escrow;
    const escrow = [e.hours, e.bidWei, e.maxGflops, e.relaysPerHour, e.gasLevel, e.metadata1];
    assert.deepEqual(chain.escrows.map((args) => args.map((v, i) => (typeof escrow[i] === 'number' ? Number(v) : String(v)))),
      [escrow]);
  });
}

test('every adding case has its reads', () => {
  const adding = TERMS.cases.filter((c) => c.expected.add).map((c) => c.name).sort();
  assert.deepEqual(Object.keys(READS.cases).sort(), adding);
  assert.equal(READS.image, IMAGE);
  assert.equal(READS.template, TEMPLATE);
});

test('the pricing bounds are read on a "2.0" PoX only', async () => {
  const c = TERMS.cases.find((k) => k.name === 'defaults-claims-off');
  for (const [version, read] of [['2.0', [PRICING]], ['1.2', []]]) {
    const runner = new EthernityCloudRunner(TOKEN, {
      provider: { getNetwork: async () => ({ chainId: 8995n }) }, signer: { getAddress: async () => WALLET }
    });
    runner.dispatchECEvent = () => {};
    await runner.resolveNetworkContext();
    const reads = [];
    runner.readPoxGeneration = async () => ({ version, matchingAddress: ethers.ZeroAddress, pricingAddress: PRICING });
    runner.readTermBounds = async (pricing) => { reads.push(pricing); return BOUNDS; };
    const { resources, options } = runOf(c.settings);
    runner.resources = resources;
    runner.runOptions = options;
    runner.selectRequestTerms(options.v2);
    await runner.prepareRequest();
    assert.deepEqual(reads, read);
    assert.ok(runner.termed);
  }
});
