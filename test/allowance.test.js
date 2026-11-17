// The allowance before a DO request is one implementation for every network
// whose PoX is apart from its token (tokenAllowance.checkAndSetAllowance,
// called by EtnyContract and EcldContract alike): the bloxberg testnet and
// Polygon Amoy walk the same steps on the same fake token, with the same
// amounts and the same events, for a legacy and for a V2 request, and the
// amount is the escrow the PoX pulls (requestEscrow: taskPrice x validators
// x duration tokens for a legacy request, escrowWei for a V2 one); bloxberg
// mainnet, whose PoX is the token, reads no allowance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ECAddress } from '../enums.js';
import EtnyContract from '../contract/operation/etnyContract.js';
import EcldContract from '../contract/operation/ecldContract.js';
import { checkAndSetAllowance } from '../contract/operation/tokenAllowance.js';
import { REQUEST_DEFAULTS, requestEscrow, requestTerms } from '../contract/operation/requestTerms.js';

const WALLET = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';
const SIGNER = { getAddress: async () => WALLET };
// Three instances over two hours: the PoX pulls 5 x 3 x 2 tokens.
const TERMED = { taskPrice: 5, validators: 3, duration: 2 };
const TERMED_ESCROW = 30;
const TERMED_ESCROW_WEI = ethers.parseUnits(String(TERMED_ESCROW), 'ether');

// The two networks whose PoX is apart from the token, and the one whose PoX
// is the token.
const BLOXBERG_TESTNET = {
  token: ECAddress.BLOXBERG.TESTNET_ADDRESS, chainId: 8995, pox: ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS, tokenClass: EtnyContract
};
const AMOY = {
  token: ECAddress.POLYGON.TESTNET_ADDRESS, chainId: 80002, pox: ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS, tokenClass: EcldContract
};
const BLOXBERG_MAINNET = {
  token: ECAddress.BLOXBERG.MAINNET_ADDRESS, chainId: 8995, pox: ECAddress.BLOXBERG.MAINNET_ADDRESS, tokenClass: EtnyContract
};

// The V2 terms of a request whose escrow is 0.03510194904 tokens.
const TERMS = {
  maxPricePerCuHourWei: ethers.parseEther('0.3'),
  maxGflops: 10,
  relaysPerHour: 0,
  gasLevel: '1000000000000000000',
  escrowWei: ethers.parseEther('0.0351') + 1949040000000n
};
const ESCROW_TOKENS = ethers.formatEther(TERMS.escrowWei);

// A fake ERC-20 recording its calls: the allowance read answers `allowance`,
// and an approval's wait records itself and sets the allowance, or throws
// when `mined` is false.
const fakeToken = (allowance, mined = true) => {
  const token = {
    calls: [],
    allowance: async (owner, spender) => {
      token.calls.push(['allowance', owner, spender]);
      return allowance;
    },
    approve: async (spender, amount) => {
      token.calls.push(['approve', spender, amount]);
      return {
        hash: '0xapprove',
        wait: async () => {
          token.calls.push(['wait', '0xapprove']);
          if (!mined) throw new Error('transaction replaced');
          allowance = amount;
          return { status: 1 };
        }
      };
    }
  };
  return token;
};

// A runner on `network` paying with `token` for `resources`, its events
// recorded.
const runnerOn = async (network, token, resources = TERMED) => {
  const runner = new EthernityCloudRunner(network.token, {
    provider: { getNetwork: async () => ({ chainId: BigInt(network.chainId) }) },
    signer: SIGNER
  });
  runner.events = [];
  runner.dispatchECEvent = (message) => runner.events.push(message);
  await runner.resolveNetworkContext();
  assert.ok(runner.tokenContract instanceof network.tokenClass);
  runner.tokenContract.getContract = () => token;
  runner.resources = resources;
  return runner;
};

// The calls and events of `network`'s allowance step with the network's PoX
// address replaced by 'POX', comparable across networks.
const stepOf = (network, token, runner) => ({
  calls: token.calls.map((call) => call.map((v) => (v === network.pox ? 'POX' : v))),
  events: runner.events.map((e) => e.split(network.pox).join('POX'))
});

// The walk of a request whose escrow is `tokens`, from an allowance of 0.
const approvalOf = (tokens, wei) => ({
  calls: [['allowance', WALLET, 'POX'], ['approve', 'POX', wei], ['wait', '0xapprove']],
  events: [
    'Checking allowance on the current wallet...',
    `Allowance for POX: 0.0 tokens, ${tokens} required`,
    `Approving allowance for ${tokens} tokens`,
    'Allowance approved (0xapprove)',
    'Allowance check completed.'
  ]
});

test('the request escrow is the task price of every instance over the duration, with the defaults of the request itself', () => {
  assert.equal(requestEscrow(TERMED), TERMED_ESCROW);
  assert.equal(requestEscrow({ taskPrice: 3, duration: 1, validators: 1 }), 3);
  assert.equal(requestEscrow({}), 10);
  assert.equal(requestEscrow(undefined), 10);
  assert.deepEqual(requestTerms({}), REQUEST_DEFAULTS);
  assert.deepEqual(requestTerms(TERMED), { ...REQUEST_DEFAULTS, ...TERMED });
  assert.deepEqual(REQUEST_DEFAULTS, { cpu: 1, memory: 1, storage: 40, bandwidth: 1, duration: 1, validators: 1, taskPrice: 10 });
});

test('a legacy request on the bloxberg testnet and on Amoy reads the allowance, approves the same escrow and waits, with the same events', async () => {
  const walks = [];
  for (const network of [BLOXBERG_TESTNET, AMOY]) {
    const token = fakeToken(0n);
    const runner = await runnerOn(network, token);
    await runner.checkAllowance();
    walks.push(stepOf(network, token, runner));
    // The approval named the network's own PoX.
    assert.equal(token.calls[1][1], network.pox);
  }
  assert.deepEqual(walks[0], approvalOf(String(TERMED_ESCROW), TERMED_ESCROW_WEI));
  assert.deepEqual(walks[1], walks[0]);
});

test('a V2 request on the bloxberg testnet and on Amoy approves its exact escrow, the same on both', async () => {
  const walks = [];
  for (const network of [BLOXBERG_TESTNET, AMOY]) {
    const token = fakeToken(0n);
    const runner = await runnerOn(network, token);
    runner.selectRequestTerms(TERMS);
    await runner.checkAllowance();
    walks.push(stepOf(network, token, runner));
  }
  assert.deepEqual(walks[0], approvalOf(ESCROW_TOKENS, TERMS.escrowWei));
  assert.deepEqual(walks[1], walks[0]);
  assert.equal(ethers.parseEther(ESCROW_TOKENS), TERMS.escrowWei);
});

test('an allowance that covers the escrow is read and left alone on both; one wei short of it is raised to the escrow', async () => {
  for (const network of [BLOXBERG_TESTNET, AMOY]) {
    // The escrow itself covers a legacy request.
    let token = fakeToken(TERMED_ESCROW_WEI);
    let runner = await runnerOn(network, token);
    await runner.checkAllowance();
    assert.deepEqual(stepOf(network, token, runner), {
      calls: [['allowance', WALLET, 'POX']],
      events: [
        'Checking allowance on the current wallet...',
        `Allowance for POX: ${TERMED_ESCROW}.0 tokens, ${TERMED_ESCROW} required`,
        'Allowance check completed.'
      ]
    }, network.pox);
    // One wei under it does not; the task price alone does not either.
    for (const short of [TERMED_ESCROW_WEI - 1n, ethers.parseUnits(String(TERMED.taskPrice), 'ether')]) {
      token = fakeToken(short);
      runner = await runnerOn(network, token);
      await runner.checkAllowance();
      assert.deepEqual(token.calls.map((c) => c[0]), ['allowance', 'approve', 'wait'], network.pox);
      assert.equal(token.calls[1][2], TERMED_ESCROW_WEI);
    }
    // The exact escrow covers a V2 request; one wei under it does not.
    token = fakeToken(TERMS.escrowWei);
    runner = await runnerOn(network, token);
    runner.selectRequestTerms(TERMS);
    await runner.checkAllowance();
    assert.deepEqual(token.calls.map((c) => c[0]), ['allowance'], network.pox);
    token = fakeToken(TERMS.escrowWei - 1n);
    runner = await runnerOn(network, token);
    runner.selectRequestTerms(TERMS);
    await runner.checkAllowance();
    assert.deepEqual(token.calls.map((c) => c[0]), ['allowance', 'approve', 'wait'], network.pox);
    assert.equal(token.calls[1][2], TERMS.escrowWei);
  }
});

test('an approval that is not mined fails the run on both with the same error, before any request', async () => {
  for (const network of [BLOXBERG_TESTNET, AMOY]) {
    const token = fakeToken(0n, false);
    const runner = await runnerOn(network, token);
    await assert.rejects(runner.checkAllowance(), /^Error: Allowance approval failed$/);
    assert.deepEqual(token.calls.map((c) => c[0]), ['allowance', 'approve', 'wait'], network.pox);
    assert.deepEqual(runner.events.slice(-1), ['Allowance approval failed: transaction replaced']);
    assert.ok(!runner.events.includes('Allowance check completed.'));
  }
});

test('the wallet balance is checked against the same escrow on every network, the mainnet included', async () => {
  for (const network of [BLOXBERG_TESTNET, AMOY, BLOXBERG_MAINNET]) {
    const runner = await runnerOn(network, fakeToken(0n));
    let balance = String(TERMED_ESCROW - 1);
    runner.tokenContract.getBalance = async () => balance;
    await assert.rejects(runner.checkWalletBalance(), /Insufficient wallet balance \(29\/30\)/);
    balance = String(TERMED_ESCROW);
    await runner.checkWalletBalance();
  }
});

test('bloxberg mainnet makes no allowance call and reports nothing of it', async () => {
  const token = fakeToken(0n);
  const runner = await runnerOn(BLOXBERG_MAINNET, token);
  await runner.checkAllowance();
  assert.deepEqual(token.calls, []);
  assert.deepEqual(runner.events, []);
  // V2 terms are refused there before any allowance step.
  assert.throws(() => runner.selectRequestTerms(TERMS), /takes no V2 request/);
  assert.deepEqual(token.calls, []);
});

test('EtnyContract and EcldContract run the one checkAndSetAllowance on their own token contract', async () => {
  const walletContext = { provider: { getNetwork: async () => ({ chainId: 8995n }) }, signer: SIGNER };
  const steps = [];
  for (const token of [new EtnyContract(BLOXBERG_TESTNET.token, walletContext), new EcldContract(AMOY.token, walletContext)]) {
    const erc20 = fakeToken(0n);
    token.getContract = () => erc20;
    const reports = [];
    assert.equal(await token.checkAndSetAllowance('0xpox', '30', (m) => reports.push(m)), true);
    steps.push({ calls: [...erc20.calls], reports });
    // Without a reporter the step runs silently, on the allowance it set.
    assert.equal(await token.checkAndSetAllowance('0xpox', '30'), true);
    assert.deepEqual(erc20.calls.slice(3), [['allowance', WALLET, '0xpox']]);
  }
  assert.deepEqual(steps[0], steps[1]);
  assert.deepEqual(steps[0].calls, [['allowance', WALLET, '0xpox'], ['approve', '0xpox', TERMED_ESCROW_WEI], ['wait', '0xapprove']]);
  assert.deepEqual(steps[0].reports, [
    'Allowance for 0xpox: 0.0 tokens, 30 required',
    'Approving allowance for 30 tokens',
    'Allowance approved (0xapprove)'
  ]);
  // The shared implementation itself, on a token already approved.
  const erc20 = fakeToken(TERMED_ESCROW_WEI);
  const reports = [];
  assert.equal(await checkAndSetAllowance(erc20, SIGNER, '0xpox', '30', (m) => reports.push(m)), true);
  assert.deepEqual(erc20.calls, [['allowance', WALLET, '0xpox']]);
  assert.deepEqual(reports, ['Allowance for 0xpox: 30.0 tokens, 30 required']);
});

test('the token contracts report the token they are bound to as their address', async () => {
  for (const network of [BLOXBERG_TESTNET, AMOY, BLOXBERG_MAINNET]) {
    const runner = await runnerOn(network, fakeToken(0n));
    assert.equal(runner.tokenContract.contractAddress(), network.token);
  }
});
