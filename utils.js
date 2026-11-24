// eslint-disable-next-line no-promise-executor-return
import { ethers } from 'ethers';
import { sha256 } from './crypto.js';

// eslint-disable-next-line no-promise-executor-return
export const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// The receipt of transaction `hash`, polled through the provider's raw RPC
// until the chain carries it, as { hash, blockNumber, status, logs }. ethers'
// TransactionResponse.wait() looks the transaction up again for a receipt
// without effectiveGasPrice (every receipt of a pre-London chain such as
// bloxberg), and when an RPC replica behind the one that served the receipt
// answers that lookup with nothing, its polling subscriber throws "report
// this; could not find tx or effectiveGasPrice" outside the awaited promise,
// which ends the process. Here a null answer and a failing read (reported to
// `onError`) are both waited through, `pollMs` apart; a reverted transaction
// is an error; past `timeoutMs` the last error is thrown. The logs are parsed
// with `iface` (an ethers Interface) when given: a log of its contract gets
// eventName and args, as in a ContractTransactionReceipt; any other log stays
// raw.
export const waitForReceipt = async (provider, hash, { iface = null, pollMs = 1000, timeoutMs = 900000, onError = () => {} } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    let raw = null;
    try {
      raw = await provider.send('eth_getTransactionReceipt', [hash]);
    } catch (e) {
      lastError = e;
      onError(e);
    }
    if (raw) {
      const status = raw.status == null ? 1 : Number(raw.status);
      if (status === 0) throw new Error(`transaction ${hash} reverted`);
      const logs = (raw.logs || []).map((log) => {
        let parsed = null;
        if (iface) {
          try { parsed = iface.parseLog({ topics: [...log.topics], data: log.data }); } catch (e) { parsed = null; }
        }
        return parsed ? { ...log, eventName: parsed.name, args: parsed.args } : { ...log };
      });
      return { hash, blockNumber: Number(raw.blockNumber), status, logs };
    }
    if (Date.now() >= deadline) {
      throw lastError || new Error(`transaction ${hash} was not mined within ${Math.round(timeoutMs / 1000)} s`);
    }
    await delay(pollMs);
  }
};

// How many times a chain read before a DO request (the wallet's balance,
// the PoX's order count, the wallet's allowance for the PoX) is tried, and
// the pause between the tries: one RPC request the provider drops (a
// browser's "Failed to fetch") fails one try, not the request.
export const READ_ATTEMPTS = 3;
export const READ_RETRY_MS = 2000;

// The value of `read`, an async function, tried up to `attempts` times
// `delayMs` apart: a rejection before the last try is passed to `onError`
// with its try number and the read is tried again; the last try's rejection
// is thrown as it is.
export const retryRead = async (read, { attempts = READ_ATTEMPTS, delayMs = READ_RETRY_MS, onError = () => {} } = {}) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= attempts) throw error;
      onError(error, attempt);
    }
    await delay(delayMs);
  }
};

// The provider's message of a failed RPC call. ethers 6 raises a browser
// wallet's EIP-1193 rejection of an eth_call as a CALL_EXCEPTION whose
// shortMessage is "missing revert data" and keeps the rejection in
// info.error: the message of that rejection's data (a wallet relaying its
// node's JSON-RPC error under "Internal JSON-RPC error.") or of the rejection
// itself (a browser's "Failed to fetch"). Without one the message is ethers'
// shortMessage, else the error's own message (a JsonRpcProvider throws its
// fetch failure as it is).
export const providerMessage = (error) =>
  error?.info?.error?.data?.message ?? error?.info?.error?.message ?? error?.shortMessage ?? error?.message ?? String(error);

// Whether a contract read failed because the contract answered it with a
// revert, or with no output of the function's type (an address without code,
// a contract without the function), rather than because the RPC did not
// answer it. ethers 6 throws every JSON-RPC error of an eth_call as a
// CALL_EXCEPTION with the node's error in info.error: a revert is one whose
// node error says so (geth's and Hardhat's "execution reverted", the bloxberg
// node's data "Reverted 0x..."), or one decoded from revert data with no node
// error; a rate limit or a wallet's "Failed to fetch" is not. An answer that
// does not decode as the function's outputs is BAD_DATA.
export const callRefused = (error) => {
  if (error?.code === 'BAD_DATA') return true;
  if (error?.code !== 'CALL_EXCEPTION') return false;
  const node = error.info?.error;
  if (!node) return true;
  return (typeof node.data === 'string' && node.data.startsWith('Reverted')) || /revert/i.test(String(node.message || ''));
};

// The widest block range one eth_getLogs call spans. The LiteForge testnet's
// Zeeve RPC (https://rpc.testnet.liteforge.zeeve.net/) refuses a wider one
// with "eth_getLogs range exceeds 3000 blocks; split the range".
export const LOG_RANGE_BLOCKS = 3000;

// The logs of `filter` on `contract` from `fromBlock` to `toBlock`, both
// inclusive, read with contract.queryFilter over consecutive ranges of at most
// LOG_RANGE_BLOCKS blocks and concatenated in range order. An empty range
// (fromBlock past toBlock) reads nothing; a failing range throws, and the
// ranges before it are read again on the next call.
export const queryFilterChunked = async (contract, filter, fromBlock, toBlock) => {
  const logs = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_RANGE_BLOCKS) {
    const to = Math.min(from + LOG_RANGE_BLOCKS - 1, toBlock);
    for (const log of await contract.queryFilter(filter, from, to)) logs.push(log);
  }
  return logs;
};

// Gas limit for a contract write: the node's estimate plus
// GAS_HEADROOM_PERCENT. The estimate is made on the previous block's state,
// and a transaction that reaches the same contract earlier in the block
// raises what the write costs (bloxberg testnet, 2026-10-25: a session close
// estimated at 82782 gas needed 86982 once the node's output row had landed
// first in its block, and reverted at the estimate). `fn` is an ethers
// contract method, `args` its arguments, `overrides` its transaction
// overrides; returns the sent transaction.
export const GAS_HEADROOM_PERCENT = 25;
export const withGasHeadroom = async (fn, args, overrides = {}) => {
  const estimate = await fn.estimateGas(...args, overrides);
  return fn(...args, { ...overrides, gasLimit: estimate + (estimate * BigInt(GAS_HEADROOM_PERCENT)) / 100n });
};
export const getCurrentTime = () => {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0'); // January is 0!
  const yyyy = today.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
};

export const getRetryDelay = (retryCount, baseDelay = 1) => baseDelay * 2 ** retryCount;
export const formatDate = (dt) => {
  // eslint-disable-next-line no-param-reassign
  if (!dt) dt = new Date();
  // eslint-disable-next-line no-unused-vars
  const padL = (nr, len = 2, chr = '0') => `${nr}`.padStart(2, chr);

  return `${padL(dt.getDate())}/${padL(dt.getMonth() + 1)}/${dt.getFullYear()} ${padL(dt.getHours())}:${padL(
    dt.getMinutes()
  )}:${padL(dt.getSeconds())}`;
};

// Generate `size` uniformly-random lowercase hex characters using a CSPRNG
// (Web Crypto's crypto.getRandomValues, available in browsers and Node >= 18 -
// the same primitive crypto.js already uses). These values feed the client
// challenge nonce and its integrity binding, so they must be unpredictable;
// Math.random() is not cryptographically secure and must not be used here.
// Masking each byte to its low nibble (byte & 0x0f) is bias-free because 256 is
// a multiple of 16.
const secureRandomHex = (size) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < size; i += 1) {
    result += (bytes[i] & 0x0f).toString(16);
  }
  return result;
};

export const generateRandomDigitsHexOfSize = (size) => secureRandomHex(size);

export const generateRandomHexOfSize = (size) => secureRandomHex(size);

export const isNullOrEmpty = (value) => value === null || value === undefined || value === '';

export const generateWallet = (clientChallenge, enclaveChallenge) => {
  try {
    const encoded = clientChallenge + enclaveChallenge;
    const hash = sha256(sha256(encoded, true), true);
    const wallet = new ethers.Wallet(`${hash}`);
    return wallet.address;
  } catch (e) {
    console.log(e);
    return false;
  }
};

export const isAddress = (address) => {
  try {
    ethers.getAddress(address);
  } catch (e) {
    return false;
  }
  return true;
};

// The node a DO request is pinned to, or '' for an unpinned request. A string
// that is an address (isAddress: any spelling ethers.getAddress takes, among
// them lowercase and without the 0x prefix) is returned in its 0x-prefixed
// EIP-55 form, the form both of its readers take: ethers resolves the `from`
// of the read of the node's requests as an ENS name when it lacks the prefix,
// and parseAddr, which the PoX reads Metadata4 with when a node places its
// order, takes the 40 hex digits after the first two characters. The zero
// address means "any node" and is returned as '': the protocol contract takes
// any non-empty Metadata4 as the address of the node the request is pinned
// to, and no node can place a request pinned to 0x0. A string that is no
// address is returned trimmed, as it is.
export const normalizeNodeAddress = (nodeAddress) => {
  const address = String(nodeAddress ?? '').trim();
  if (!isAddress(address)) return address;
  const node = ethers.getAddress(address);
  return node === ethers.ZeroAddress ? '' : node;
};

// The enclave-signed result transaction: its signer, target, chain id (0 for a
// pre-EIP-155 signature) and the order id and result string it was signed
// over. Throws unless it is an _addResultToOrder call.
export const parseTransactionBytes = (contract, bytesInput) => {
  const parsedTransaction = ethers.Transaction.from(bytesInput);
  const iface = new ethers.Interface(contract);
  const decodedData = iface.parseTransaction({ data: parsedTransaction.data, value: parsedTransaction.value });
  if (!decodedData || decodedData.name !== '_addResultToOrder') {
    throw new Error('the result transaction is not an _addResultToOrder call');
  }
  return {
    from: parsedTransaction.from,
    to: parsedTransaction.to,
    chainId: parsedTransaction.chainId,
    orderId: decodedData.args[0],
    result: decodedData.args[1]
  };
};
