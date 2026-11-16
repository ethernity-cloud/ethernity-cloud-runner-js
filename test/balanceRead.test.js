// A wallet whose balance cannot be read is never reported as empty: a
// rejected balanceOf makes EtnyContract.getBalance and EcldContract.getBalance
// throw an Error naming the token, the wallet, the token address and the
// provider's message (tokenBalance.readTokenBalance, utils.providerMessage:
// for a browser wallet's EIP-1193 rejection, which ethers raises as a
// CALL_EXCEPTION reading "missing revert data", the rejection's own message),
// and runner.checkWalletBalance throws it as it is after READ_ATTEMPTS reads
// READ_RETRY_MS apart (utils.retryRead), the wallet's address resolved once
// before them; the allowance read of tokenAllowance.checkAndSetAllowance is
// tried the same way and names the cause when every try fails; the faucet
// path is never drawn on a failed read.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import EthernityCloudRunner from '../runner.js';
import { ECAddress, ECEcldTestnetConfig, ECLog, ECNetworkConfig } from '../enums.js';
import EtnyContract from '../contract/operation/etnyContract.js';
import EcldContract from '../contract/operation/ecldContract.js';
import etnyAbi from '../contract/abi/etnyAbi.js';
import { readTokenBalance } from '../contract/operation/tokenBalance.js';
import { checkAndSetAllowance } from '../contract/operation/tokenAllowance.js';
import { ProviderAccountSigner } from '../walletContext.js';
import { READ_ATTEMPTS, READ_RETRY_MS, providerMessage, retryRead } from '../utils.js';

const WALLET = '0x4d0bb63ae867d04dd627fceb4519c9b93d2717b4';
// The address as a browser wallet's signer reports it.
const ACCOUNT = ethers.getAddress(WALLET);
const OTHER = '0x71d005d502bd2EEBD2368f35EA33e66cD7A63CB7';
const SIGNER = { getAddress: async () => WALLET };
const TOKEN = ECAddress.BLOXBERG.TESTNET_ADDRESS;
const POX = ECAddress.BLOXBERG.TESTNET_PROTOCOL_ADDRESS;
const providerOn = (chainId) => ({ getNetwork: async () => ({ chainId: BigInt(chainId) }) });
const walletContext = { provider: providerOn(8995), signer: SIGNER };
// The browser's network error as fetch throws it, and as a browser wallet
// relays it under its own JSON-RPC error.
const fetchFailed = () => new TypeError('Failed to fetch');
const relayed = () => ({ code: -32603, message: 'Internal JSON-RPC error.', data: { message: 'Failed to fetch' } });
const FETCH_FAILED = 'Failed to fetch';

// A browser wallet (an EIP-1193 provider) on the bloxberg testnet holding
// `accounts`, whose every other request is rejected with `reject()`; the
// methods requested are listed in `requests`.
const browserWallet = (reject, accounts = [WALLET]) => {
  const requests = [];
  return {
    requests,
    request: async ({ method }) => {
      requests.push(method);
      if (method === 'eth_chainId') return '0x2323';
      if (method === 'eth_accounts') return accounts;
      throw reject();
    }
  };
};

// The tETNY token bound to the account of `wallet` through ethers'
// BrowserProvider, as the runner binds it from a wallet context.
const browserToken = (wallet) => {
  const provider = new ethers.BrowserProvider(wallet);
  const signer = new ProviderAccountSigner(provider);
  return { provider, signer, token: new ethers.Contract(TOKEN, etnyAbi.abi, signer) };
};

// The error ethers throws for a balanceOf a browser wallet rejects with
// `reject()`.
const callException = async (reject) => {
  const { provider, token } = browserToken(browserWallet(reject));
  try {
    return await token.balanceOf(WALLET).then(() => assert.fail('answered'), (e) => e);
  } finally {
    provider.destroy();
  }
};
const FETCH_EXCEPTION = await callException(fetchFailed);
const RELAYED_EXCEPTION = await callException(relayed);

// A read answering `answers` in turn, the last one from then on; an Error
// among them is thrown. `calls` lists the arguments of the reads.
const reading = (answers) => {
  const read = async (...args) => {
    const answer = answers[Math.min(read.calls.length, answers.length - 1)];
    read.calls.push(args);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  read.calls = [];
  return read;
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

// The outcome of `start()` on faked timers: the clock is advanced by
// READ_RETRY_MS, the pause between the tries of a read, until the outcome
// settles (ethers' BrowserProvider sends each request from a 0 ms timer, so
// one advance serves one request or one pause).
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

// A runner on the bloxberg testnet paying for a request whose escrow is 3
// tokens, its events recorded as [message, level].
const runnerOn = async (address = TOKEN, chainId = 8995, context = { provider: providerOn(chainId), signer: SIGNER }) => {
  const runner = new EthernityCloudRunner(address, context);
  runner.events = [];
  runner.dispatchECEvent = (message, level) => runner.events.push([message, level]);
  await runner.resolveNetworkContext();
  runner.resources = { taskPrice: 3, validators: 1, duration: 1 };
  return runner;
};

test('ethers raises a browser wallet\'s rejection of an eth_call as a CALL_EXCEPTION reading "missing revert data"; providerMessage names the rejection', () => {
  for (const exception of [FETCH_EXCEPTION, RELAYED_EXCEPTION]) {
    assert.equal(exception.code, 'CALL_EXCEPTION');
    assert.equal(exception.shortMessage, 'missing revert data');
    assert.equal(providerMessage(exception), FETCH_FAILED);
  }
  assert.equal(FETCH_EXCEPTION.info.error.message, FETCH_FAILED);
  assert.deepEqual(RELAYED_EXCEPTION.info.error.data, { message: FETCH_FAILED });
  // An error ethers raises with no rejection in it is named by its short
  // message; an error of the platform's by its message.
  assert.equal(providerMessage(ethers.makeError('could not coalesce error', 'UNKNOWN_ERROR', {})), 'could not coalesce error');
  assert.equal(providerMessage(fetchFailed()), FETCH_FAILED);
  assert.equal(providerMessage(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8545'), { code: 'ECONNREFUSED' })), 'connect ECONNREFUSED 127.0.0.1:8545');
  assert.equal(providerMessage('timeout'), 'timeout');
});

test('retryRead tries a read up to three times: a read that fails twice then succeeds passes, each failure reported with its try', async () => {
  const [first, second] = [fetchFailed(), FETCH_EXCEPTION];
  const read = reading([first, second, '751.0']);
  const failures = [];
  assert.equal(await retryRead(read, { delayMs: 1, onError: (error, attempt) => failures.push([error, attempt]) }), '751.0');
  assert.equal(read.calls.length, 3);
  assert.deepEqual(failures, [[first, 1], [second, 2]]);
  // A read that succeeds at once is read once and reports nothing.
  const once = reading(['751.0']);
  assert.equal(await retryRead(once, { delayMs: 1, onError: () => assert.fail('reported') }), '751.0');
  assert.equal(once.calls.length, 1);
});

test('a read that fails three times throws the last error as it is, after the two reported failures', async () => {
  const errors = [fetchFailed(), fetchFailed(), RELAYED_EXCEPTION];
  const read = reading(errors);
  const failures = [];
  await assert.rejects(retryRead(read, { delayMs: 1, onError: (error, attempt) => failures.push([error, attempt]) }), (e) => e === errors[2]);
  assert.equal(read.calls.length, 3);
  assert.deepEqual(failures, [[errors[0], 1], [errors[1], 2]]);
});

test('the tries are three, two seconds apart', async () => {
  assert.equal(READ_ATTEMPTS, 3);
  assert.equal(READ_RETRY_MS, 2000);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const read = reading([fetchFailed(), '751.0']);
    const pending = retryRead(read);
    await settle();
    assert.equal(read.calls.length, 1);
    // One millisecond short of the pause the read is not tried again.
    mock.timers.tick(READ_RETRY_MS - 1);
    await settle();
    assert.equal(read.calls.length, 1);
    mock.timers.tick(1);
    assert.equal(await pending, '751.0');
    assert.equal(read.calls.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test('a rejected balanceOf makes getBalance of both token classes throw the error naming the token, the wallet and the provider\'s message', async () => {
  for (const [Token, field, name] of [[EtnyContract, 'etnyContract', 'tETNY'], [EcldContract, 'ecldContract', 'tECLD']]) {
    const token = new Token(TOKEN, walletContext, name);
    assert.equal(token.tokenName, name);
    const cause = fetchFailed();
    token[field] = { target: TOKEN, balanceOf: async () => { throw cause; } };
    await assert.rejects(token.getBalance(), (e) => {
      assert.equal(e.message, `could not read the ${name} balance of ${WALLET} at ${TOKEN}: ${FETCH_FAILED}`);
      assert.equal(e.cause, cause);
      return true;
    });
    // The rejection of a browser wallet is named, not ethers' CALL_EXCEPTION.
    for (const exception of [FETCH_EXCEPTION, RELAYED_EXCEPTION]) {
      token[field] = { target: TOKEN, balanceOf: async () => { throw exception; } };
      await assert.rejects(token.getBalance(), { message: `could not read the ${name} balance of ${WALLET} at ${TOKEN}: ${FETCH_FAILED}`, cause: exception });
    }
    // A read that succeeds is the balance in tokens, of the signer's wallet,
    // or of the wallet given.
    const balanceOf = reading([ethers.parseEther('751')]);
    token[field] = { target: TOKEN, balanceOf };
    assert.equal(await token.getBalance(), '751.0');
    assert.equal(await token.getBalance(OTHER), '751.0');
    assert.deepEqual(balanceOf.calls, [[WALLET], [OTHER]]);
  }
  // Built without a name, a class names its token 'token'.
  const unnamed = new EtnyContract(TOKEN, walletContext);
  assert.equal(unnamed.tokenName, 'token');
  unnamed.etnyContract = { target: TOKEN, balanceOf: async () => { throw fetchFailed(); } };
  await assert.rejects(unnamed.getBalance(), { message: `could not read the token balance of ${WALLET} at ${TOKEN}: ${FETCH_FAILED}` });
  // The one implementation both call.
  await assert.rejects(readTokenBalance({ target: '0xtoken', balanceOf: async () => { throw fetchFailed(); } }, WALLET, 'ETNY'), {
    message: `could not read the ETNY balance of ${WALLET} at 0xtoken: ${FETCH_FAILED}`
  });
});

test('through a BrowserProvider over a browser wallet rejecting eth_call, the balance read names the wallet\'s message, for a fetch error and for a relayed one', async () => {
  for (const reject of [fetchFailed, relayed]) {
    const wallet = browserWallet(reject);
    const { provider, token } = browserToken(wallet);
    try {
      await assert.rejects(readTokenBalance(token, WALLET, 'tETNY'), (e) => {
        assert.equal(e.message, `could not read the tETNY balance of ${WALLET} at ${TOKEN}: ${FETCH_FAILED}`);
        assert.equal(e.cause.code, 'CALL_EXCEPTION');
        return true;
      });
    } finally {
      provider.destroy();
    }
    assert.deepEqual(wallet.requests.filter((m) => m === 'eth_call'), ['eth_call']);
  }
});

test('through a BrowserProvider over a browser wallet rejecting eth_call, the allowance read is tried three times and names the wallet\'s message', async () => {
  for (const reject of [fetchFailed, relayed]) {
    const wallet = browserWallet(reject);
    const { provider, signer, token } = browserToken(wallet);
    const reports = [];
    try {
      await assert.rejects(throughRetries(() => checkAndSetAllowance(token, signer, POX, '3', (m) => reports.push(m))), {
        message: `could not read the allowance of ${ACCOUNT} for ${POX} at ${TOKEN}: ${FETCH_FAILED}`
      });
    } finally {
      provider.destroy();
    }
    assert.deepEqual(reports, [
      `Allowance read failed (try 1 of 3), retrying: ${FETCH_FAILED}`,
      `Allowance read failed (try 2 of 3), retrying: ${FETCH_FAILED}`
    ]);
    assert.equal(wallet.requests.filter((m) => m === 'eth_call').length, 3);
  }
});

test('the runner names its token by the descriptor: every descriptor carries a tokenName', async () => {
  const names = [];
  for (const [address, chainId] of [[TOKEN, 8995], [ECAddress.BLOXBERG.MAINNET_ADDRESS, 8995], [ECAddress.POLYGON.TESTNET_ADDRESS, 80002], [ECAddress.POLYGON.MAINNET_ADDRESS, 137]]) {
    names.push((await runnerOn(address, chainId)).tokenContract.tokenName);
  }
  assert.deepEqual(names, ['tETNY', 'ETNY', 'tECLD', 'ECLD']);
  for (const cfg of [...Object.values(ECNetworkConfig), ...Object.values(ECEcldTestnetConfig)]) {
    assert.ok(['tETNY', 'ETNY', 'tECLD', 'ECLD'].includes(cfg.tokenName), cfg.networkName);
  }
  // The shared-token testnets before their chainId is known pay in tECLD.
  const shared = new EthernityCloudRunner(ECAddress.IOTEX.TESTNET_ADDRESS, { provider: providerOn(4690), signer: SIGNER });
  assert.equal(shared.tokenContract.tokenName, 'tECLD');
});

test('checkWalletBalance throws the read error unchanged after three failed reads, each failure a WARNING event, and never reports the wallet as empty', async () => {
  const runner = await runnerOn();
  const cause = fetchFailed();
  runner.tokenContract.etnyContract = { target: TOKEN, balanceOf: async () => { throw cause; } };
  const message = `could not read the tETNY balance of ${WALLET} at ${TOKEN}: ${FETCH_FAILED}`;
  await assert.rejects(throughRetries(() => runner.checkWalletBalance()), (e) => {
    assert.equal(e.message, message);
    assert.equal(e.cause, cause);
    return true;
  });
  assert.deepEqual(runner.events, [
    ['Checking wallet balance....', undefined],
    [`Wallet balance read failed (try 1 of 3), retrying: ${message}`, ECLog.WARNING],
    [`Wallet balance read failed (try 2 of 3), retrying: ${message}`, ECLog.WARNING]
  ]);
  // The very error getBalance throws is the one thrown.
  const error = new Error('signer gone');
  runner.tokenContract.getBalance = async () => { throw error; };
  await assert.rejects(throughRetries(() => runner.checkWalletBalance()), (e) => e === error);
});

test('a balance read that fails twice then succeeds passes the check; "Insufficient wallet balance" is a read that succeeded', async () => {
  const runner = await runnerOn();
  const balanceOf = reading([fetchFailed(), FETCH_EXCEPTION, ethers.parseEther('751')]);
  runner.tokenContract.etnyContract = { target: TOKEN, balanceOf };
  await throughRetries(() => runner.checkWalletBalance());
  // The signer's wallet, resolved once and read three times.
  assert.deepEqual(balanceOf.calls, [[WALLET], [WALLET], [WALLET]]);
  assert.deepEqual(runner.events.map(([m]) => m.split(',')[0]), [
    'Checking wallet balance....', 'Wallet balance read failed (try 1 of 3)', 'Wallet balance read failed (try 2 of 3)'
  ]);
  // A wallet read short of the escrow is refused as before, on the read.
  runner.tokenContract.etnyContract = { target: TOKEN, balanceOf: async () => ethers.parseEther('2') };
  await assert.rejects(runner.checkWalletBalance(), /^Error: Insufficient wallet balance \(2\.0\/3\)$/);
});

test('a browser wallet whose account is not connected is asked for it once before the read: a refused request is thrown as it is, with no retry and no read', async () => {
  const wallet = browserWallet(() => ({ code: 4001, message: 'User rejected the request.' }), []);
  const provider = new ethers.BrowserProvider(wallet);
  const runner = await runnerOn(TOKEN, 8995, { provider, signer: new ProviderAccountSigner(provider) });
  try {
    await assert.rejects(throughRetries(() => runner.checkWalletBalance()), (e) => {
      assert.equal(e.code, 'ACTION_REJECTED');
      assert.equal(e.shortMessage, 'user rejected action');
      return true;
    });
  } finally {
    provider.destroy();
  }
  assert.deepEqual(wallet.requests.filter((m) => m !== 'eth_chainId' && m !== 'eth_accounts'), ['eth_requestAccounts']);
  assert.deepEqual(runner.events, [['Checking wallet balance....', undefined]]);
});

test('the faucet path is not drawn on a failed read: the read error is thrown before the balance is judged', async () => {
  const runner = await runnerOn();
  let draws = 0;
  runner.tokenContract.getFaucetTokens = async () => { draws += 1; return { hash: '0xfaucet' }; };
  const error = fetchFailed();
  runner.tokenContract.getBalance = async () => { throw error; };
  await assert.rejects(runner.getTokensFromFaucet(), (e) => e === error);
  assert.equal(draws, 0);
  // A wallet read above the faucet's threshold draws nothing either.
  runner.tokenContract.getBalance = async () => '751.0';
  assert.deepEqual(await runner.getTokensFromFaucet(), { success: true });
  assert.equal(draws, 0);
});

test('the allowance read is tried three times, each failure reported; a read that fails twice then succeeds completes the step', async () => {
  const allowance = reading([fetchFailed(), RELAYED_EXCEPTION, ethers.parseEther('3')]);
  const token = { target: TOKEN, allowance, approve: async () => assert.fail('approved') };
  const reports = [];
  assert.equal(await throughRetries(() => checkAndSetAllowance(token, SIGNER, POX, '3', (m) => reports.push(m))), true);
  assert.deepEqual(allowance.calls, [[WALLET, POX], [WALLET, POX], [WALLET, POX]]);
  assert.deepEqual(reports, [
    `Allowance read failed (try 1 of 3), retrying: ${FETCH_FAILED}`,
    `Allowance read failed (try 2 of 3), retrying: ${FETCH_FAILED}`,
    `Allowance for ${POX}: 3.0 tokens, 3 required`
  ]);
});

test('an allowance read that fails three times throws the error naming the wallet, the PoX, the token and the provider message, through the runner too', async () => {
  const token = { target: TOKEN, allowance: reading([fetchFailed(), fetchFailed(), FETCH_EXCEPTION]), approve: async () => assert.fail('approved') };
  const cause = `could not read the allowance of ${WALLET} for ${POX} at ${TOKEN}: ${FETCH_FAILED}`;
  await assert.rejects(throughRetries(() => checkAndSetAllowance(token, SIGNER, POX, '3')), (e) => {
    assert.equal(e.message, cause);
    assert.equal(e.cause, FETCH_EXCEPTION);
    return true;
  });
  assert.equal(token.allowance.calls.length, 3);
  const runner = await runnerOn();
  const failing = { target: TOKEN, allowance: reading([fetchFailed()]), approve: async () => assert.fail('approved') };
  runner.tokenContract.getContract = () => failing;
  await assert.rejects(throughRetries(() => runner.checkAllowance()), { message: cause });
  assert.equal(failing.allowance.calls.length, 3);
  assert.deepEqual(runner.events.map(([m]) => m), [
    'Checking allowance on the current wallet...',
    `Allowance read failed (try 1 of 3), retrying: ${FETCH_FAILED}`,
    `Allowance read failed (try 2 of 3), retrying: ${FETCH_FAILED}`
  ]);
});
