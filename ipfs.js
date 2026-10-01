import { create } from 'ipfs-http-client';
import { delay, getRetryDelay } from './utils.js';
import { ECError } from './enums.js';

// process.env is undefined in non-React browser bundles; guard so the module
// loads there and falls back to the default retry count.
const env = typeof process !== 'undefined' && process.env ? process.env : {};

let ipfs = null;

// Lets the runner detect whether a storage endpoint was already configured
// (via initializeStorage) so it can fall back to a default instead of calling
// ipfs.add on a null client.
export const isInitialized = () => ipfs !== null;

export const initialize = (host, protocol, port, token) => {
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

// Every blob the runner adds (challenge, code, input, session rows) is stored
// as a CIDv1 raw sha256 block: the CID is base32(0x01 0x55 0x12 0x20 ||
// sha256(content)), computable from the bytes alone. The node pins results
// with the same recipe (mvp-pox-node utils.py cidv1_raw).
const RAW_BLOCK_OPTIONS = { cidVersion: 1, rawLeaves: true };

export const uploadToIPFS = async (code) => {
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

export const getFromIPFS = async (hash, maxRetries = env.REACT_APP_IPFS_RETRIES || 100) => {
  let res = '';
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
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
