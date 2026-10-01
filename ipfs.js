import { create } from 'ipfs-http-client';
import { ethers } from 'ethers';
import { delay, getRetryDelay } from './utils.js';
import { ECError } from './enums.js';

// process.env is undefined in non-React browser bundles; guard so the module
// loads there and falls back to the default retry count.
const env = typeof process !== 'undefined' && process.env ? process.env : {};

let ipfs = null;

// The bootnode's payload intake, when the application configured no IPFS API
// of its own: artefact CIDs are computed here and the bytes are delivered to
// POST {intake}/payload/<network>/<doRequestId>/<cid> once the DO request is
// on chain (mvp-pox-node ipfs_intake.py). Reads go to {intake}/api/v0.
let intake = null;
// cid -> Uint8Array awaiting delivery to the intake.
const pending = new Map();

export const PUBLIC_INTAKE = 'https://ipfs.ethernity.cloud';

// Lets the runner detect whether a storage endpoint was already configured
// (via initializeStorage or initializeIntake) so it can fall back to a default
// instead of calling ipfs.add on a null client.
export const isInitialized = () => ipfs !== null || intake !== null;

export const initialize = (host, protocol, port, token) => {
  intake = null;
  if (host.search('http') !== -1) {
    ipfs = create(host);
  } else if (token === '') {
    ipfs = create({
      host,
      protocol,
      port
    });
  } else {
    // example of authorization headers
    // headers: {
    //     authorization: 'Bearer ' + TOKEN
    //   }
    // const auth =
    //     'Basic ' + Buffer.from(INFURA_ID + ':' + INFURA_SECRET_KEY).toString('base64');
    ipfs = create({
      host,
      protocol,
      port,
      headers: { authorization: token }
    });
  }
};

// `network` is the name the node agent uses (`bloxberg_testnet`, ...).
export const initializeIntake = (network, baseUrl = PUBLIC_INTAKE) => {
  ipfs = null;
  intake = { baseUrl: baseUrl.replace(/\/+$/, ''), network };
  pending.clear();
};

// Every blob the runner adds (challenge, code, input, session rows) is stored
// as a CIDv1 raw sha256 block: the CID is base32(0x01 0x55 0x12 0x20 ||
// sha256(content)), computable from the bytes alone. The node pins results
// with the same recipe (mvp-pox-node utils.py cidv1_raw).
const RAW_BLOCK_OPTIONS = { cidVersion: 1, rawLeaves: true };

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

const base32Lower = (bytes) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

export const cidv1Raw = (bytes) => {
  const digest = ethers.getBytes(ethers.sha256(bytes));
  const raw = new Uint8Array(4 + digest.length);
  raw.set([0x01, 0x55, 0x12, 0x20], 0);
  raw.set(digest, 4);
  return `b${base32Lower(raw)}`;
};

const toBytes = (data) => (data instanceof Uint8Array ? data : ethers.toUtf8Bytes(String(data)));

export const uploadToIPFS = async (code) => {
  if (intake) {
    const bytes = toBytes(code);
    const cid = cidv1Raw(bytes);
    pending.set(cid, bytes);
    return cid;
  }
  // NOTE: this MUST NOT silently return null on failure. Callers interpolate the
  // returned hash into the on-chain DO-request metadata; a null there gets
  // serialized as the literal string "null", the node then can't fetch it,
  // cancels the (already paid) order, and the task can never complete. Throw so
  // the caller aborts BEFORE submitting the request. Also validate the response
  // actually contains a path.
  const response = await ipfs.add(code, RAW_BLOCK_OPTIONS);
  if (!response || !response.path) {
    throw new Error('uploadToIPFS: IPFS add returned no path (upload failed)');
  }
  return response.path;
};

// Deliver every queued blob to the intake for `doRequest`. A blob the intake
// confirms (200) leaves the queue; one it refuses (4xx other than 409) throws
// at once, since retrying the same bytes cannot change the answer; a network
// failure or 5xx is retried. No-op without an intake.
export const flushPending = async (doRequest, attempts = 3, delayMs = 5000) => {
  if (!intake || pending.size === 0) return;
  for (const [cid, bytes] of Array.from(pending.entries())) {
    const url = `${intake.baseUrl}/payload/${intake.network}/${doRequest}/${cid}`;
    let last = '';
    let delivered = false;
    for (let attempt = 0; attempt < attempts && !delivered; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes
        });
        if (response.status === 200) {
          pending.delete(cid);
          delivered = true;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        const text = (await response.text()).slice(0, 200);
        if (response.status >= 400 && response.status < 500 && response.status !== 409) {
          throw new Error(`intake refused ${cid} for request ${doRequest}: ${response.status} ${text}`);
        }
        last = `${response.status} ${text}`;
      } catch (e) {
        if (String(e.message).startsWith('intake refused')) throw e;
        last = e.message;
      }
      // eslint-disable-next-line no-await-in-loop
      if (attempt + 1 < attempts) await delay(delayMs);
    }
    if (!delivered) {
      throw new Error(`intake did not accept ${cid} for request ${doRequest} after ${attempts} attempts: ${last}`);
    }
  }
};

// export const getFromIPFS = async (hash) => {
//   let res = '';
//   try {
//     // eslint-disable-next-line no-restricted-syntax
//     for await (const file of ipfs.cat(hash)) {
//       res += new TextDecoder().decode(file.buffer);
//     }
//
//     return res;
//   } catch (error) {
//     console.error(error.message);
//     await delay(2000);
//     return getFromIPFS(hash);
//   }
// };

const catFromIntakeApi = async (hash) => {
  const response = await fetch(`${intake.baseUrl}/api/v0/cat?arg=${hash}`, { method: 'POST' });
  if (response.status !== 200) {
    throw new Error(`cat ${hash}: ${response.status}`);
  }
  return response.text();
};

export const getFromIPFS = async (hash, maxRetries = env.REACT_APP_IPFS_RETRIES || 100) => {
  let res = '';
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      if (intake) {
        // eslint-disable-next-line no-await-in-loop
        return await catFromIntakeApi(hash);
      }
      // eslint-disable-next-line no-restricted-syntax,no-await-in-loop
      for await (const file of ipfs.cat(hash)) {
        res += new TextDecoder().decode(file.buffer);
      }

      return res;
    } catch (error) {
      console.error(error.message);
      retryCount += 1;

      if (retryCount < maxRetries) {
        // eslint-disable-next-line no-await-in-loop
        await delay(1000);
        // eslint-disable-next-line no-continue
        continue;
      } else {
        throw new Error(ECError.IPFS_DOWNLOAD_ERROR);
      }
    }
  }
};
