// EthernityCloudRunner chooses per request, before its add, between the claims
// path and the path it has served requests by before (MATCHING-DESIGN.md
// section 8 item 4 and section 13, roll-out step 3): a network whose
// descriptor names no PoxMatching, every PoX 1.0 network among them, reads
// nothing of matching; on one that names it, claimsOn() decides, and with
// claims off the request is added and approved as before; with claims on the
// PoxMatchReader is the one PoxMatching's reader() names and the escrow the
// one escrowFor answers. A request pinned to a banned node is refused on such
// a network whatever claimsOn() answers (D33). No chain: the contracts are
// stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import EthernityCloudRunner, { v2TermsOf } from '../runner.js';
import { ClaimsPath } from '../claims.js';
import { ECAddress, ECEcldTestnetConfig, ECNetworkConfig } from '../enums.js';

const NODE = '0xB78804B94a49579e8c4e1A98e9e965BF3D15062F';
const WALLET = '0xF79648481c486406F0872401bDCfdA2d6152a6E1';
const NOW = 1795008240;
const V2 = { maxPricePerCuHourWei: 10n ** 18n, maxGflops: 400n, relaysPerHour: 0n, gasLevel: 10n ** 18n, escrowWei: 3n * 10n ** 18n };

const runnerOn = () => {
  const runner = new EthernityCloudRunner(ECAddress.BLOXBERG.TESTNET_ADDRESS, {
    provider: { getNetwork: async () => ({ chainId: 8995n }) }, signer: { getAddress: async () => WALLET }
  });
  runner.dispatchECEvent = () => {};
  return runner;
};

const DESCRIPTORS = [...Object.entries(ECNetworkConfig), ...Object.entries(ECEcldTestnetConfig)];

for (const [key, cfg] of DESCRIPTORS) {
  test(`a network without PoxMatching reads nothing of it: ${cfg.networkKey} ${cfg.isMainnet ? 'MAINNET' : 'TESTNET'} (${key})`, async () => {
    assert.equal(cfg.matchingAddress, undefined);
    const runner = runnerOn();
    runner.networkConfig = cfg;
    runner.requestedNodeAddress = NODE;
    runner.matchingContracts = () => assert.fail('MatchingContracts built for a network whose descriptor names no PoxMatching');
    await runner.prepareRequest();
    assert.equal(runner.claims, null);
  });
}

const READER = `0x${'02'.repeat(20)}`;

class Chain {
  constructor(on, bannedUntil = 0, reader = READER) {
    Object.assign(this, { on, bannedUntil, readerAddress: reader, reads: [] });
  }

  async claimsOn() { this.reads.push('claimsOn'); return this.on; }

  async bindReader() {
    this.reads.push('reader');
    if (BigInt(this.readerAddress) === 0n) throw new Error('PoxMatching names no PoxMatchReader (reader() is zero)');
    return this.readerAddress;
  }

  async nodeStanding(node) { this.reads.push(['nodeStanding', node]); return { score: 0, beatAgeSlots: 0, bannedUntil: this.bannedUntil }; }

  async chainTime() { return NOW; }

  async template() { this.reads.push('template'); return { registered: false, marked: false }; }

  async imageHealth() { return { s7: 1, f7: 0, nodes: 1, owners: 1, marked: false }; }

  async imageRecords() { return { registry: null, records: null, releaseLanguage: null, session: `0x${'00'.repeat(32)}`, latest: `0x${'00'.repeat(32)}`, currentImage: null }; }

  async bidQuoteFor() { return { counted: 1, minBidWei: 10n ** 17n, baseNowWei: 10n ** 17n }; }

  async escrowFor(...args) {
    this.reads.push(['escrowFor', ...args]);
    return { escrowWei: 2n * 10n ** 18n, workWei: 0n, chainFeeWei: 0n, escrowGflops: 400, trustedZoneFee: 10, secureLockFee: 0 };
  }
}

const onMatchingNetwork = (chain, v2Terms = V2) => {
  const runner = runnerOn();
  runner.networkConfig = { ...ECNetworkConfig[ECAddress.BLOXBERG.TESTNET_ADDRESS], matchingAddress: `0x${'01'.repeat(20)}` };
  runner.matchingContracts = (cfg) => {
    runner.builtFor = cfg;
    return chain;
  };
  runner.v2Terms = v2Terms;
  runner.runOptions = { v2: { requiredGflops: 250 } };
  runner.resources = { cpu: 1, memory: 1, storage: 10, bandwidth: 1, duration: 1 };
  runner.enclaveImageIPFSHash = 'QmImage';
  runner.requestedNodeAddress = '';
  runner.allowances = [];
  runner.balanceWei = async () => 10n ** 19n;
  runner.allowWei = async (wei) => { runner.allowances.push(wei); };
  return runner;
};

test('claims off serves the request as before', async () => {
  const chain = new Chain(false);
  const runner = onMatchingNetwork(chain);
  await runner.prepareRequest();
  assert.equal(runner.claims, null);
  assert.deepEqual(chain.reads, ['claimsOn']);
  assert.equal(runner.builtFor.matchingAddress, `0x${'01'.repeat(20)}`);
  assert.deepEqual(runner.allowances, []);
});

test('claims on serves the request by claims on the reader PoxMatching names, after the reads before the add', async () => {
  const chain = new Chain(true);
  const runner = onMatchingNetwork(chain);
  await runner.prepareRequest();
  assert.ok(runner.claims instanceof ClaimsPath);
  assert.deepEqual(chain.reads.map((r) => (Array.isArray(r) ? r[0] : r)), ['claimsOn', 'reader', 'template', 'escrowFor']);
  assert.equal(chain.reads[3][6], `v3:QmImage:${runner.resolveTrustedZoneImage()}`);
  assert.deepEqual(runner.allowances, [2n * 10n ** 18n]);
  assert.equal(runner.claims.imageCid, 'QmImage');
  assert.equal(runner.claims.maxGflops(), (250n << 16n) | 400n);
});

test('claims on while PoxMatching names no reader is refused', async () => {
  const chain = new Chain(true, 0, `0x${'00'.repeat(20)}`);
  const runner = onMatchingNetwork(chain);
  await assert.rejects(() => runner.prepareRequest(), /names no PoxMatchReader/);
  assert.deepEqual(chain.reads, ['claimsOn', 'reader']);
  assert.equal(runner.claims, null);
});

test('claims on without V2 terms is refused', async () => {
  const chain = new Chain(true);
  const runner = onMatchingNetwork(chain, null);
  await assert.rejects(() => runner.prepareRequest(), /V2 terms/);
  assert.equal(runner.claims, null);
  assert.deepEqual(chain.reads, ['claimsOn']);
});

test('escrowWei may be left out on a network that names a PoxMatching, and is refused while claims are off', async () => {
  assert.throws(() => v2TermsOf({ ...V2, escrowWei: undefined }), /options\.v2\.escrowWei must be an integer/);
  const terms = v2TermsOf({ ...V2, escrowWei: undefined }, { escrowOptional: true });
  assert.equal(terms.escrowWei, null);
  assert.throws(() => v2TermsOf({ ...V2, escrowWei: '0' }, { escrowOptional: true }), /escrowWei must be above 0/);
  const on = onMatchingNetwork(new Chain(true), terms);
  await on.prepareRequest();
  assert.equal(on.claims.settings.terms.escrowWei, null);
  assert.deepEqual(on.allowances, [2n * 10n ** 18n]);
  const off = onMatchingNetwork(new Chain(false), terms);
  await assert.rejects(() => off.prepareRequest(), /options\.v2\.escrowWei must be an integer .*without claims/);
});

test('V2 terms without an escrowWei read no balance and approve nothing before the claims path', async () => {
  const runner = onMatchingNetwork(new Chain(true), v2TermsOf({ ...V2, escrowWei: undefined }, { escrowOptional: true }));
  runner.tokenContract = {
    getSigner: () => assert.fail('the balance was read before the claims path'),
    checkAndSetAllowance: () => assert.fail('an allowance was set before the claims path')
  };
  await runner.checkWalletBalance();
  await runner.checkAllowance();
});

test('selectRequestTerms leaves escrowWei optional only where the descriptor names a PoxMatching', () => {
  const runner = onMatchingNetwork(new Chain(true));
  runner.selectRequestTerms({ ...V2, escrowWei: undefined });
  assert.equal(runner.v2Terms.escrowWei, null);
  runner.networkConfig = { ...runner.networkConfig, matchingAddress: undefined };
  assert.throws(() => runner.selectRequestTerms({ ...V2, escrowWei: undefined }), /options\.v2\.escrowWei must be an integer/);
});

for (const on of [false, true]) {
  test(`a request pinned to a banned node is refused (claims ${on ? 'on' : 'off'})`, async () => {
    const chain = new Chain(on, NOW + 60);
    const runner = onMatchingNetwork(chain);
    runner.requestedNodeAddress = NODE;
    await assert.rejects(() => runner.prepareRequest(), /banned until/);
    assert.deepEqual(chain.reads, [['nodeStanding', NODE]]);
  });
}

test('a request pinned to a node that is not banned goes on', async () => {
  const chain = new Chain(false, NOW);
  const runner = onMatchingNetwork(chain);
  runner.requestedNodeAddress = NODE;
  await runner.prepareRequest();
  assert.equal(runner.claims, null);
  assert.deepEqual(chain.reads, [['nodeStanding', NODE], 'claimsOn']);
});

const protocolStub = (adds) => ({
  getContract: () => ({
    _getOrdersCount: async () => 21n,
    interface: { parseLog: () => ({ name: '_addDORequestEV', args: [WALLET, 4349n] }) }
  }),
  getProvider: () => ({ send: async () => ({ status: '0x1', blockNumber: '0x1', logs: [{ topics: [], data: '0x' }] }) }),
  addDORequest: async (...args) => { adds.push(['_addDORequest', ...args]); return { hash: '0xlegacy' }; },
  addDORequestV2: async (...args) => { adds.push(['addDORequestV2', ...args]); return { hash: '0xv2' }; }
});

test('the claims path adds its request through the claims path, the path as before through the PoX', async () => {
  const adds = [];
  const runner = runnerOn();
  await runner.resolveNetworkContext();
  runner.protocolContract = protocolStub(adds);
  runner.resources = { cpu: 1, memory: 1, storage: 10, bandwidth: 1, duration: 1, validators: 1, taskPrice: 3 };
  runner.requestedNodeAddress = '';
  runner.claims = { addRequest: async (metadata) => { adds.push(['claims', metadata]); return { hash: '0xclaims' }; } };
  await runner.createDORequest('image', 'code', 'input');
  runner.claims = null;
  await runner.createDORequest('image', 'code', 'input');
  assert.deepEqual(adds.map((a) => a[0]), ['claims', '_addDORequest']);
  assert.deepEqual(adds[0][1], ['image', 'code', 'input', '']);
});

test('a request served by claims is approved by the claims path and sends no _approveOrder', async () => {
  const runner = runnerOn();
  runner.claims = { awaitApproval: async () => 7 };
  runner.doRequest = 301;
  runner.readOrder = async () => ({ dproc: NODE, dpRequest: 3n });
  runner.approveOrder = () => assert.fail('the claims path sent _approveOrder');
  assert.equal(await runner.findOrder(), true);
  assert.equal(runner.orderId, 7);
  assert.equal(runner.nodeAddress, NODE);
});
