// eslint-disable-next-line no-promise-executor-return
import { ethers } from 'ethers';
import { sha256 } from './crypto.js';

// eslint-disable-next-line no-promise-executor-return
export const delay = (ms) => new Promise((res) => setTimeout(res, ms));
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

export const parseTransactionBytes = (contract, bytesInput) => {
  const parsedTransaction = ethers.Transaction.from(bytesInput);
  const iface = new ethers.Interface(contract);
  const decodedData = iface.parseTransaction({ data: parsedTransaction.data, value: parsedTransaction.value });
  return {
    from: parsedTransaction.from,
    result: decodedData.args[1]
  };
};
