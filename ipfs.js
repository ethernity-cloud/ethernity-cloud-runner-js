import { create } from 'ipfs-http-client';
import { ethers } from 'ethers';
import { delay } from './utils.js';
import { ECError } from './enums.js';

let ipfs = null;

// The bootnode's payload intake, when the application configured no IPFS API
// of its own: artefact CIDs are computed here and the bytes are delivered to
// POST {intake}/payload/<network>/<doRequestId>/<cid> once the DO request is
// on chain (mvp-pox-node ipfs_intake.py). Reads go to {intake}/api/v0.
let intake = null;
// cid -> Uint8Array awaiting delivery to the intake. The queue is shared by
// every runner instance of the process; flushPending delivers only the CIDs
// its caller names, so one request's blobs never go out under another's id.
const pending = new Map();

export const PUBLIC_INTAKE = 'https://ipfs.ethernity.cloud';

// Whether a storage endpoint is configured (initialize or initializeIntake).
export const isInitialized = () => ipfs !== null || intake !== null;

// The application's own Kubo RPC API, as a URL (`http://127.0.0.1:5001`) or as
// host, protocol and port. A non-empty `token` is sent as given in the
// Authorization header of every request, so a "Bearer " prefix is the caller's
// choice; the public API's add and pin answer 403 without a writer token.
export const initialize = (host, protocol, port, token) => {
  intake = null;
  const headers = token ? { authorization: token } : undefined;
  if (host.search('http') !== -1) {
    ipfs = create({ url: host, headers });
  } else {
    ipfs = create({ host, protocol, port, headers });
  }
};

// `network` is the name the node agent uses (`bloxberg_testnet`, ...).
export const initializeIntake = (network, baseUrl = PUBLIC_INTAKE) => {
  ipfs = null;
  intake = { baseUrl: baseUrl.replace(/\/+$/, ''), network };
  pending.clear();
};

// Every blob the runner adds (challenge, code, input, session rows) is stored
// as CIDv1 raw sha256 blocks of at most RAW_BLOCK_MAX bytes, Kubo's largest
// chunk: a blob of up to one block has the CID base32(0x01 0x55 0x12 0x20 ||
// sha256(content)), computable from the bytes alone. The node adds with the
// same parameters (mvp-pox-node utils.py add_bytes_raw).
export const RAW_BLOCK_MAX = 1048576;
const RAW_BLOCK_OPTIONS = { cidVersion: 1, rawLeaves: true, chunker: `size-${RAW_BLOCK_MAX}` };

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

// The HTTP status an ipfs-http-client error carries (ipfs-utils HTTPError), or
// undefined for a failure with no response.
const responseStatus = (e) => e && e.response && e.response.status;

// The CID of `code` through the configured storage: queued for the intake, or
// added to the Kubo RPC API. An add the API does not answer within `timeoutMs`
// is aborted and retried `attempts` times. The bound is an abort signal:
// ipfs-http-client sends a per-call `timeout` option to the server as a query
// parameter instead of applying it to the request. A 401 or 403 ends the
// attempts at once: the API refuses this caller, which the same request cannot
// change. Always returns a CID or throws: callers interpolate the CID into the
// on-chain DO-request metadata, and the request must not be submitted (and paid
// for) without it. Through the intake, a blob above RAW_BLOCK_MAX throws: its
// CID is a DAG root only an IPFS node computes, so the intake, which checks the
// bytes against the CID the request names, would refuse it after the request
// had been paid for.
export const uploadToIPFS = async (code, attempts = 3, delayMs = 5000, timeoutMs = 60000) => {
  if (intake) {
    const bytes = toBytes(code);
    if (bytes.length > RAW_BLOCK_MAX) {
      throw new Error(
        `uploadToIPFS: a ${bytes.length}-byte artefact is above the ${RAW_BLOCK_MAX}-byte limit of the payload ` +
          "intake; deliver it through an IPFS API of your own (initializeStorage('http://127.0.0.1:5001')) " +
          'or the public API with a writer token.'
      );
    }
    const cid = cidv1Raw(bytes);
    pending.set(cid, bytes);
    return cid;
  }
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await ipfs.add(code, { ...RAW_BLOCK_OPTIONS, signal: controller.signal });
      if (response && response.path) return response.path;
      last = new Error('IPFS add returned no path');
    } catch (e) {
      const status = responseStatus(e);
      if (status === 401 || status === 403) {
        throw new Error(
          `uploadToIPFS: the IPFS API refused the add (${status}). Its add takes a writer token, the token ` +
            "parameter of initializeStorage(); without one, deliver through the bootnode's intake " +
            "(initializePublicIntake()) or your own Kubo RPC API (initializeStorage('http://127.0.0.1:5001'))."
        );
      }
      last = controller.signal.aborted ? new Error(`no answer within ${timeoutMs} ms`) : e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await delay(delayMs);
  }
  throw new Error(`uploadToIPFS: upload failed after ${attempts} attempts: ${last?.message || last}`);
};

// Deliver the queued blobs `cids` names to the intake for `doRequest`: the
// artefacts that request carries, which its caller uploaded. A blob the intake
// confirms (200) leaves the queue; one it refuses (4xx other than 409) throws
// at once, since retrying the same bytes cannot change the answer; a network
// failure or 5xx is retried. A CID with no queued blob throws: nothing was
// uploaded through the intake under it. No-op without an intake.
export const flushPending = async (doRequest, cids, attempts = 3, delayMs = 5000) => {
  if (!intake) return;
  for (const cid of cids) {
    const bytes = pending.get(cid);
    if (!bytes) {
      throw new Error(`flushPending: ${cid} was not uploaded through the intake`);
    }
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

// One read request is given this long before it is abandoned and the next
// endpoint tried.
export const READ_TIMEOUT_MS = 60000;
// The public gateway a result is read from when the configured endpoint does
// not answer; it is a mirror of the same content, reached without credentials.
const PUBLIC_GATEWAY = 'https://ipfs.io/ipfs';

const fetchText = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status !== 200) {
      throw new Error(`${url}: ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

// The configured endpoint: the intake's read API, or the application's own
// Kubo RPC through the client `initialize` built.
const catConfigured = async (hash) => {
  if (intake) {
    return fetchText(`${intake.baseUrl}/api/v0/cat?arg=${hash}`, { method: 'POST' });
  }
  let res = '';
  // eslint-disable-next-line no-restricted-syntax
  for await (const file of ipfs.cat(hash, { timeout: READ_TIMEOUT_MS })) {
    res += new TextDecoder().decode(file.buffer);
  }
  return res;
};

// Read a blob: the configured endpoint first, the public gateway second, each
// request bounded by READ_TIMEOUT_MS, the whole read by `deadline` (a
// Date.now() value) with at least one round. Throws ECError.IPFS_DOWNLOAD_ERROR
// once the deadline has passed with no answer.
export const getFromIPFS = async (hash, deadline = Date.now() + 10 * 60 * 1000) => {
  let last = '';
  for (;;) {
    for (const read of [catConfigured, (h) => fetchText(`${PUBLIC_GATEWAY}/${h}`)]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await read(hash);
      } catch (error) {
        last = error.message;
      }
    }
    if (Date.now() >= deadline) {
      console.error(`could not read ${hash} before the deadline: ${last}`);
      throw new Error(ECError.IPFS_DOWNLOAD_ERROR);
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(5000);
  }
};
