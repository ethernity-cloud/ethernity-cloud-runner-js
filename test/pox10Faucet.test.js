// How a wallet short of a request's escrow is funded on the PoX 1.0 testnet
// networks. The bloxberg copy's token (tE10) has no faucet: the run is
// refused with the amount the wallet lacks and where the token comes from,
// and no transaction is sent. The Amoy copy is paid in the test ECLD, whose
// faucet() mints 1000 tokens to a caller holding less than 100: the runner
// draws it, waits for the receipt, reads the balance again and judges that
// read. On every other network a short wallet is refused as before and no
// faucet is drawn. No chain: the token's balanceOf, the signer and the
// provider are stand-ins.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ECAddress, ECLog } from '../enums.js';
import { drawTokenFaucet } from '../contract/operation/tokenFaucet.js';
import { READ_RETRY_MS } from '../utils.js';

const WALLET = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';
const BLOXBERG_POX10 = '0x69A7bEB5Da2d3dA711d52E491D71e51296b08745';
const AMOY_TOKEN = '0x9927809B61122B2af3f3b3A3303875e0687b8eE3';
const FAUCET_TX = `0x${'f'.repeat(64)}`;
// The call data of faucet().
const FAUCET_CALL = ethers.id('faucet()').slice(0, 10);

// A wallet on `chainId`: a provider that answers the chain id and the receipt
// of every transaction with `receiptStatus`, and a signer of WALLET that
// records what it is asked to send in `sent` and answers FAUCET_TX.
const walletOn = (chainId, receiptStatus = '0x1') => {
  const sent = [];
  const receipts = [];
  const provider = {
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    send: async (method, params) => {
      assert.equal(method, 'eth_getTransactionReceipt');
      receipts.push(params[0]);
      return { status: receiptStatus, blockNumber: '0x10', logs: [] };
    }
  };
  const signer = {
    provider,
    getAddress: async () => WALLET,
    sendTransaction: async (tx) => { sent.push(tx); return { hash: FAUCET_TX }; }
  };
  return { provider, signer, sent, receipts };
};

// A balanceOf answering `balances` (tokens) in turn, the last one from then
// on; an Error among them is thrown. `calls` counts the reads.
const balanceOf = (balances) => {
  const read = async () => {
    const balance = balances[Math.min(read.calls, balances.length - 1)];
    read.calls += 1;
    if (balance instanceof Error) throw balance;
    return ethers.parseEther(String(balance));
  };
  read.calls = 0;
  return read;
};

// A runner on `address`, named onto `name` when given, paying for a request
// whose escrow is `escrow` tokens from a wallet whose balance reads as
// `balances`. Its events are recorded as [message, level].
const runnerOn = async (address, chainId, balances, { name = null, escrow = 3, receiptStatus = '0x1' } = {}) => {
  const wallet = walletOn(chainId, receiptStatus);
  const runner = new EthernityCloudRunner(address, { provider: wallet.provider, signer: wallet.signer });
  runner.events = [];
  runner.dispatchECEvent = (message, level) => runner.events.push([message, level]);
  await runner.resolveNetworkContext();
  if (name) await runner.setNetwork(...name);
  runner.resources = { taskPrice: escrow, validators: 1, duration: 1 };
  const read = balanceOf(balances);
  const field = runner.networkConfig.family === 'bloxberg' ? 'etnyContract' : 'ecldContract';
  runner.tokenContract[field] = { target: address, balanceOf: read };
  return { runner, read, ...wallet };
};

const amoyPox10 = (balances, options = {}) =>
  runnerOn(AMOY_TOKEN, 80002, balances, { ...options, name: ['POLYGON', 'TESTNET_POX10'] });

const settle = () => new Promise((resolve) => setImmediate(resolve));

// The outcome of `start()` on faked timers, the clock advanced by the pause
// between the tries of a read until the outcome settles.
const throughRetries = async (start) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let settled = false;
    const pending = start().finally(() => { settled = true; });
    pending.catch(() => {});
    for (let advances = 0; !settled; advances += 1) {
      assert.ok(advances < 100, 'the read did not settle');
      await settle();
      mock.timers.tick(READ_RETRY_MS);
    }
    return await pending;
  } finally {
    mock.timers.reset();
  }
};

test('drawTokenFaucet sends faucet() to the token from the signer, waits for its receipt and returns the hash', async () => {
  const { provider, signer, sent, receipts } = walletOn(80002);
  const reported = [];
  assert.equal(await drawTokenFaucet(AMOY_TOKEN, signer, provider, (hash) => reported.push(hash)), FAUCET_TX);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, AMOY_TOKEN);
  assert.equal(sent[0].data, FAUCET_CALL);
  assert.equal(FAUCET_CALL, '0xde5f72fd');
  assert.deepEqual(reported, [FAUCET_TX]);
  assert.deepEqual(receipts, [FAUCET_TX]);
});

test('a faucet transaction that reverts is an error', async () => {
  const { provider, signer, sent } = walletOn(80002, '0x0');
  await assert.rejects(drawTokenFaucet(AMOY_TOKEN, signer, provider), { message: `transaction ${FAUCET_TX} reverted` });
  assert.equal(sent.length, 1);
});

test('the bloxberg PoX 1.0 network: an unfunded wallet is refused with what it lacks and where tE10 comes from, and nothing is sent', async () => {
  const { runner, read, sent } = await runnerOn(BLOXBERG_POX10, 8995, [0]);
  await assert.rejects(runner.checkWalletBalance(), {
    message: `Insufficient wallet balance (0.0/3): ${WALLET} lacks 3.0 tE10. tE10 has no faucet: a wallet receives it by a transfer from the owner of the BLOXBERG TESTNET_POX10 contracts.`
  });
  assert.equal(read.calls, 1);
  assert.deepEqual(sent, []);
  assert.deepEqual(runner.events, [['Checking wallet balance....', undefined]]);
});

test('the bloxberg PoX 1.0 network: a wallet short of part of the escrow lacks the rest; a funded wallet passes', async () => {
  const short = await runnerOn(BLOXBERG_POX10, 8995, ['1.5'], { escrow: 4 });
  await assert.rejects(short.runner.checkWalletBalance(), {
    message: `Insufficient wallet balance (1.5/4): ${WALLET} lacks 2.5 tE10. tE10 has no faucet: a wallet receives it by a transfer from the owner of the BLOXBERG TESTNET_POX10 contracts.`
  });
  assert.deepEqual(short.sent, []);
  const funded = await runnerOn(BLOXBERG_POX10, 8995, [3]);
  await funded.runner.checkWalletBalance();
  assert.equal(funded.read.calls, 1);
  assert.deepEqual(funded.sent, []);
});

test('the bloxberg PoX 1.0 network: getTokensFromFaucet answers that the token has no faucet and sends nothing', async () => {
  const { runner, read, sent } = await runnerOn(BLOXBERG_POX10, 8995, [0]);
  assert.deepEqual(await runner.getTokensFromFaucet(), {
    success: false,
    message: 'tE10 has no faucet: a wallet receives it by a transfer from the owner of the BLOXBERG TESTNET_POX10 contracts.'
  });
  assert.equal(read.calls, 0);
  assert.deepEqual(sent, []);
});

test('the Amoy PoX 1.0 network: a wallet below the faucet\'s threshold and short of the escrow draws the faucet and passes on the new balance', async () => {
  const { runner, read, sent, receipts } = await amoyPox10([0, 1000]);
  await runner.checkWalletBalance();
  assert.equal(read.calls, 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, AMOY_TOKEN);
  assert.equal(sent[0].data, FAUCET_CALL);
  assert.deepEqual(receipts, [FAUCET_TX]);
  assert.deepEqual(runner.events, [
    ['Checking wallet balance....', undefined],
    ['The wallet holds 0.0 tECLD: drawing the tECLD faucet (1000 tECLD to a wallet holding less than 100)...', undefined],
    [`${FAUCET_TX} is pending...`, undefined],
    [`Faucet drawn (${FAUCET_TX}).`, undefined]
  ]);
});

test('the Amoy PoX 1.0 network: a wallet that covers the escrow draws nothing, at any balance', async () => {
  for (const balance of [3, 50, 99, 100, 5000]) {
    const { runner, read, sent } = await amoyPox10([balance]);
    await runner.checkWalletBalance();
    assert.equal(read.calls, 1, String(balance));
    assert.deepEqual(sent, [], String(balance));
  }
});

test('the Amoy PoX 1.0 network: a wallet the faucet does not serve is refused with what it lacks, and nothing is sent', async () => {
  for (const balance of ['100.0', '150.5']) {
    const { runner, read, sent } = await amoyPox10([balance], { escrow: 200 });
    const lacking = ethers.formatEther(ethers.parseEther('200') - ethers.parseEther(balance));
    await assert.rejects(runner.checkWalletBalance(), {
      message: `Insufficient wallet balance (${balance}/200): ${WALLET} lacks ${lacking} tECLD. The tECLD faucet mints 1000 tECLD to a wallet holding less than 100, and to no other.`
    });
    assert.equal(read.calls, 1);
    assert.deepEqual(sent, []);
  }
});

test('the Amoy PoX 1.0 network: a wallet still short after the draw is refused on the new balance, after one draw', async () => {
  const { runner, read, sent } = await amoyPox10([20, 1020], { escrow: 2000 });
  await assert.rejects(runner.checkWalletBalance(), {
    message: `Insufficient wallet balance (1020.0/2000): ${WALLET} lacks 980.0 tECLD. The tECLD faucet mints 1000 tECLD to a wallet holding less than 100, and to no other.`
  });
  assert.equal(read.calls, 2);
  assert.equal(sent.length, 1);
});

test('the Amoy PoX 1.0 network: a read after the draw that still answers the old balance is repeated, three times at most', async () => {
  // The second read after the draw answers the minted balance.
  const lagging = await amoyPox10([0, 0, 1000]);
  await throughRetries(() => lagging.runner.checkWalletBalance());
  assert.equal(lagging.read.calls, 3);
  assert.equal(lagging.sent.length, 1);
  // No read after the draw answers another balance: three reads, then the refusal.
  const unchanged = await amoyPox10([0]);
  await assert.rejects(throughRetries(() => unchanged.runner.checkWalletBalance()), {
    message: `Insufficient wallet balance (0.0/3): ${WALLET} lacks 3.0 tECLD. The tECLD faucet mints 1000 tECLD to a wallet holding less than 100, and to no other.`
  });
  assert.equal(unchanged.read.calls, 4);
  assert.equal(unchanged.sent.length, 1);
});

test('the Amoy PoX 1.0 network: a V2 request\'s escrow is judged in wei, before and after the draw', async () => {
  const terms = { maxPricePerCuHourWei: 1n, maxGflops: 0n, relaysPerHour: 1n, gasLevel: 1n };
  const covered = await amoyPox10(['0.5', '1000.5']);
  covered.runner.selectRequestTerms({ ...terms, escrowWei: ethers.parseEther('0.75') });
  await covered.runner.checkWalletBalance();
  assert.equal(covered.sent.length, 1);
  const short = await amoyPox10(['150']);
  short.runner.selectRequestTerms({ ...terms, escrowWei: ethers.parseEther('150.25') });
  await assert.rejects(short.runner.checkWalletBalance(), {
    message: `Insufficient wallet balance (150.0 tokens for an escrow of 150.25): ${WALLET} lacks 0.25 tECLD. The tECLD faucet mints 1000 tECLD to a wallet holding less than 100, and to no other.`
  });
  assert.deepEqual(short.sent, []);
});

test('the Amoy PoX 1.0 network: no faucet is drawn on a balance read that failed', async () => {
  const error = new TypeError('Failed to fetch');
  const { runner, read, sent } = await amoyPox10([error]);
  const message = `could not read the tECLD balance of ${WALLET} at ${AMOY_TOKEN}: Failed to fetch`;
  await assert.rejects(throughRetries(() => runner.checkWalletBalance()), { message, cause: error });
  assert.equal(read.calls, 3);
  assert.deepEqual(sent, []);
  assert.deepEqual(runner.events.map(([m, level]) => [m.split(',')[0], level]), [
    ['Checking wallet balance....', undefined],
    ['Wallet balance read failed (try 1 of 3)', ECLog.WARNING],
    ['Wallet balance read failed (try 2 of 3)', ECLog.WARNING]
  ]);
});

test('the Amoy PoX 1.0 network: a draw that reverts ends the check with the revert', async () => {
  const { runner, read, sent } = await amoyPox10([0, 1000], { receiptStatus: '0x0' });
  await assert.rejects(runner.checkWalletBalance(), { message: `transaction ${FAUCET_TX} reverted` });
  assert.equal(read.calls, 1);
  assert.equal(sent.length, 1);
});

test('the Amoy PoX 1.0 network: getTokensFromFaucet draws for a wallet below the threshold and for no other', async () => {
  const below = await amoyPox10(['99.5']);
  assert.deepEqual(await below.runner.getTokensFromFaucet(), { success: true });
  assert.equal(below.sent.length, 1);
  assert.equal(below.sent[0].to, AMOY_TOKEN);
  assert.equal(below.sent[0].data, FAUCET_CALL);
  for (const balance of [100, 751]) {
    const at = await amoyPox10([balance]);
    assert.deepEqual(await at.runner.getTokensFromFaucet(), { success: true });
    assert.deepEqual(at.sent, [], String(balance));
  }
  // A draw that reverts is answered, not thrown; a balance read that fails is thrown.
  const reverted = await amoyPox10([0], { receiptStatus: '0x0' });
  assert.deepEqual(await reverted.runner.getTokensFromFaucet(), {
    success: false,
    message: `The tECLD faucet was not drawn: transaction ${FAUCET_TX} reverted`
  });
  const error = new TypeError('Failed to fetch');
  const unread = await amoyPox10([error]);
  await assert.rejects(unread.runner.getTokensFromFaucet(), {
    message: `could not read the tECLD balance of ${WALLET} at ${AMOY_TOKEN}: Failed to fetch`
  });
  assert.deepEqual(unread.sent, []);
});

test('a short wallet on a published network is refused as before: the published message, and no faucet drawn', async () => {
  // Polygon Amoy's PoX 2.0 network is paid in the same test ECLD.
  const amoy = await runnerOn(AMOY_TOKEN, 80002, [0]);
  assert.equal(amoy.runner.networkConfig.faucet, undefined);
  await assert.rejects(amoy.runner.checkWalletBalance(), { message: 'Insufficient wallet balance (0.0/3)' });
  assert.equal(amoy.read.calls, 1);
  assert.deepEqual(amoy.sent, []);
  // Named onto the PoX 1.0 network and back, the runner draws nothing again.
  await amoy.runner.setNetwork('POLYGON', 'TESTNET_POX10');
  await amoy.runner.setNetwork('POLYGON', 'TESTNET');
  await assert.rejects(amoy.runner.checkWalletBalance(), { message: 'Insufficient wallet balance (0.0/3)' });
  assert.deepEqual(amoy.sent, []);

  const bloxberg = await runnerOn(ECAddress.BLOXBERG.TESTNET_ADDRESS, 8995, [2]);
  await assert.rejects(bloxberg.runner.checkWalletBalance(), { message: 'Insufficient wallet balance (2.0/3)' });
  assert.deepEqual(bloxberg.sent, []);

  const mainnet = await runnerOn(ECAddress.POLYGON.MAINNET_ADDRESS, 137, [2]);
  await assert.rejects(mainnet.runner.checkWalletBalance(), { message: 'Insufficient wallet balance (2.0/3)' });
  assert.deepEqual(mainnet.sent, []);

  const terms = { maxPricePerCuHourWei: 1n, maxGflops: 0n, relaysPerHour: 1n, gasLevel: 1n, escrowWei: ethers.parseEther('5') };
  amoy.runner.selectRequestTerms(terms);
  await assert.rejects(amoy.runner.checkWalletBalance(), { message: 'Insufficient wallet balance (0.0 tokens for an escrow of 5.0)' });
  assert.deepEqual(amoy.sent, []);
});
