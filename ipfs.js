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

// What the public intake takes per blob (mvp-pox-node ipfs_intake.py,
// max_bytes); the limit of an intake of the application's own is given to
// initializeIntake. A blob above it is not sent to the intake: it is held in
// the runner's local cache (`held`, cid -> bytes), uploadToIPFS throws
// StorageLimitError before any transaction names the blob, and the held blobs
// are uploaded by uploadHeld() once an IPFS endpoint of the application's own
// is set (runner.initializeStorage calls it).
export const INTAKE_MAX_BYTES = 100 * 1024 * 1024;
const held = new Map();

export class StorageLimitError extends Error {
  constructor(cid, size, limit) {
    super(
      `the intake takes a blob of up to ${limit} bytes and this one is ${size} bytes; it is held in the ` +
        `runner's local cache as ${cid} and is uploaded when an IPFS endpoint of the application's own is set ` +
        '(initializeStorage(url, token)); then run or send again'
    );
    this.name = 'StorageLimitError';
    this.cid = cid;
    this.size = size;
    this.limit = limit;
  }
}

// The blobs held in the local cache, as [{ cid, size }].
export const heldBlobs = () => Array.from(held, ([cid, bytes]) => ({ cid, size: bytes.length }));

// Upload the held blobs through the IPFS API configured by initialize(); each
// one the API takes leaves the cache. Returns { uploaded: [cid], failed: { cid:
// reason } }; nothing is uploaded while the storage is the intake, which does
// not take them.
export const uploadHeld = async () => {
  const uploaded = [];
  const failed = {};
  if (!ipfs) return { uploaded, failed };
  for (const [cid, bytes] of Array.from(held)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const added = await uploadToIPFS(bytes);
      if (added !== cid) {
        failed[cid] = `the API named the bytes ${added}`;
        continue;
      }
      held.delete(cid);
      uploaded.push(cid);
    } catch (e) {
      failed[cid] = e.message;
    }
  }
  return { uploaded, failed };
};

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

// `network` is the name the node agent uses (`bloxberg_testnet`, ...);
// `maxBytes` is what this intake takes per blob (INTAKE_MAX_BYTES for the
// public one).
export const initializeIntake = (network, baseUrl = PUBLIC_INTAKE, maxBytes = INTAKE_MAX_BYTES) => {
  ipfs = null;
  intake = { baseUrl: baseUrl.replace(/\/+$/, ''), network, maxBytes };
  pending.clear();
};

// Every blob the runner adds (challenge, code, input, session rows) is stored
// as Kubo's `add --cid-version=1 --raw-leaves` stores it with its default
// chunker: in raw sha256 blocks of BLOCK_SIZE bytes (the last one shorter), a
// single block as it is, several under a balanced UnixFS tree of at most
// LINKS_PER_NODE blocks per node. unixfsCid() computes the resulting CID from
// the bytes alone, without an IPFS node, and an IPFS node adding the same
// bytes with its default settings names them the same; the chunker is passed
// all the same, for a node whose default was changed. The node adds with the
// same parameters (mvp-pox-node utils.py add_bytes_raw).
export const BLOCK_SIZE = 262144;
const LINKS_PER_NODE = 174;
const RAW_BLOCK_OPTIONS = { cidVersion: 1, rawLeaves: true, chunker: `size-${BLOCK_SIZE}` };

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

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const varint = (n) => {
  const out = [];
  for (;;) {
    const byte = n % 128;
    n = Math.floor(n / 128);
    if (n === 0) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    out.push(byte | 0x80);
  }
};

// A protobuf field: varint (wire 0) or length-delimited (wire 2).
const field = (number, wire, payload) => {
  const tag = varint(number * 8 + wire);
  return wire === 2 ? concat([tag, varint(payload.length), payload]) : concat([tag, payload]);
};

// CIDv1, codec raw (0x55), sha2-256 (0x12, 32 bytes).
const rawCidBytes = (bytes) => concat([Uint8Array.from([0x01, 0x55, 0x12, 0x20]), ethers.getBytes(ethers.sha256(bytes))]);

// A dag-pb UnixFS File node over `children`, each [cid, tsize, filesize];
// returns [cid, tsize, filesize]. Links come before Data in dag-pb; a link
// carries the child's CID, an empty Name and its Tsize, the size of the
// child's subtree; Data is UnixFS Type=File(2), filesize, blocksizes.
const fileNode = (children) => {
  const links = concat(children.map(([cid, tsize]) =>
    field(2, 2, concat([field(1, 2, cid), field(2, 2, new Uint8Array(0)), field(3, 0, varint(tsize))]))));
  const filesize = children.reduce((n, [, , size]) => n + size, 0);
  const data = concat([field(1, 0, varint(2)), field(3, 0, varint(filesize)),
    ...children.map(([, , size]) => field(4, 0, varint(size)))]);
  const block = concat([links, field(1, 2, data)]);
  const cid = concat([Uint8Array.from([0x01, 0x70, 0x12, 0x20]), ethers.getBytes(ethers.sha256(block))]);
  return [cid, block.length + children.reduce((n, [, tsize]) => n + tsize, 0), filesize];
};

// The CID Kubo gives `bytes` for `add` with RAW_BLOCK_OPTIONS: the raw block's
// CID up to one block, else the root of the balanced UnixFS tree over the
// blocks, LINKS_PER_NODE to a node, every node full but the last.
export const unixfsCid = (bytes, blockSize = BLOCK_SIZE) => {
  if (bytes.length <= blockSize) return `b${base32Lower(rawCidBytes(bytes))}`;
  let nodes = [];
  for (let i = 0; i < bytes.length; i += blockSize) {
    const chunk = bytes.subarray(i, i + blockSize);
    nodes.push([rawCidBytes(chunk), chunk.length, chunk.length]);
  }
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += LINKS_PER_NODE) next.push(fileNode(nodes.slice(i, i + LINKS_PER_NODE)));
    nodes = next;
  }
  return `b${base32Lower(nodes[0][0])}`;
};

// The CID of `bytes` as one raw block: its CID through RAW_BLOCK_OPTIONS up to
// BLOCK_SIZE bytes.
export const cidv1Raw = (bytes) => `b${base32Lower(rawCidBytes(bytes))}`;

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
// for) without it. Through the intake the CID is computed here (unixfsCid) and
// the bytes are delivered by flushPending once the request names the CID.
export const uploadToIPFS = async (code, attempts = 3, delayMs = 5000, timeoutMs = 60000) => {
  if (intake) {
    const bytes = toBytes(code);
    const cid = unixfsCid(bytes);
    if (bytes.length > intake.maxBytes) {
      held.set(cid, bytes);
      throw new StorageLimitError(cid, bytes.length, intake.maxBytes);
    }
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
// The intake answers 403 with this text while its own RPC replica has not yet
// seen the row that names the cid; the row is on chain (its receipt came
// back before the delivery), so the answer changes within seconds.
export const INTAKE_NOT_NAMED = 'does not name this cid';
export const INTAKE_NOT_NAMED_ATTEMPTS = 12;

// A blob the DO request does not name yet is lodged with the intake under the
// request owner's EIP-191 signature of ownerSignatureMessage(network, doRequest)
// (header OWNER_SIGNATURE_HEADER; one signature serves every blob of the
// request), so the bytes are at the bootnode before the row that names them is
// committed: a runner that stops between the two leaves no row without bytes,
// and the node reads the bytes the moment it reads the row (mvp-pox-node
// ipfs_intake.py).
export const OWNER_SIGNATURE_HEADER = 'X-Etny-Owner-Signature';
export const ownerSignatureMessage = (network, doRequest) => `etny-intake|${network}|${doRequest}`;
// The network the intake is configured for, null without an intake.
export const intakeNetwork = () => (intake ? intake.network : null);
// The text of the 403 an intake without the signed path answers a lodged blob
// with: its row path still delivers the blob, after the row.
export const INTAKE_UNSIGNED_PATH = INTAKE_NOT_NAMED;

// Deliver the queued blobs `cids` names to the intake for `doRequest` under
// the owner's `signature`, before the request names them, each tried
// `attempts` times `delayMs` apart through connection failures and 5xx.
// Returns the CIDs the intake took (`delivered`), which leave the queue, and
// the answer for each it did not take (`refused`, cid -> text), which stays
// queued for flushPending after the row. Never throws for an intake answer.
// Nothing without an intake.
export const deliverSigned = async (doRequest, cids, signature, attempts = 3, delayMs = 5000) => {
  const delivered = [];
  const refused = {};
  if (!intake) return { delivered, refused };
  for (const cid of cids) {
    const bytes = pending.get(cid);
    if (!bytes) continue;
    const url = `${intake.baseUrl}/payload/${intake.network}/${doRequest}/${cid}`;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', [OWNER_SIGNATURE_HEADER]: signature },
          body: bytes
        });
        if (response.status === 200) {
          pending.delete(cid);
          delivered.push(cid);
          delete refused[cid];
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        refused[cid] = `${response.status} ${(await response.text()).slice(0, 200)}`;
        if (response.status < 500) break;
      } catch (e) {
        refused[cid] = e.message;
      }
      // eslint-disable-next-line no-await-in-loop
      if (attempt < attempts) await delay(delayMs);
    }
  }
  return { delivered, refused };
};

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
    let allowed = attempts;
    for (let attempt = 0; attempt < allowed && !delivered; attempt += 1) {
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
        const notNamedYet = response.status === 403 && text.includes(INTAKE_NOT_NAMED);
        if (notNamedYet) allowed = Math.max(allowed, INTAKE_NOT_NAMED_ATTEMPTS);
        if (response.status >= 400 && response.status < 500 && response.status !== 409 && !notNamedYet) {
          throw new Error(`intake refused ${cid} for request ${doRequest}: ${response.status} ${text}`);
        }
        last = `${response.status} ${text}`;
      } catch (e) {
        if (String(e.message).startsWith('intake refused')) throw e;
        last = e.message;
      }
      // eslint-disable-next-line no-await-in-loop
      if (attempt + 1 < allowed) await delay(delayMs);
    }
    if (!delivered) {
      throw new Error(`intake did not accept ${cid} for request ${doRequest} after ${allowed} attempts: ${last}`);
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
