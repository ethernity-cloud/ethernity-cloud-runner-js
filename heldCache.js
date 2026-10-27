// The runner's held cache: the artefacts the public intake does not take
// (above its size limit, ipfs.INTAKE_MAX_BYTES), kept until an IPFS endpoint
// of the application's own uploads them and a transaction on chain names
// them. Every artefact is kept by its CID in BLOCK_SIZE chunks, the size of
// the IPFS blocks it is uploaded as, and found again by the artefact key the
// runner derives from the plaintext and the enclave key it was sealed for
// (runner._sealArtefact), so a run repeated after the upload references the
// held ciphertext's CID instead of sealing the plaintext again.
//
// Three stores, chosen by openHeldCache() from the environment:
//   IndexedDbHeldCache  a browser: database `ethernity-cloud-runner`, the
//                       chunks and the index under the dApp's origin, persistent
//                       across reloads (navigator.storage.persist() is asked
//                       for once, so the browser does not evict them);
//   FileHeldCache       Node: one file per CID and index.json under
//                       ~/.ethernity-cloud/held (configureHeldCache changes it);
//   MemoryHeldCache     anywhere else: the process's memory.
// A store that cannot keep the bytes (the browser's quota, an unwritable
// directory) throws HeldCacheError, so the data is never dropped silently.
import { BLOCK_SIZE } from './ipfs.js';

export class HeldCacheError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HeldCacheError';
  }
}

const entryOf = (key, cid, size, digest) => ({ key, cid, size, digest, uploaded: false, heldAt: Date.now() });

const chunksOf = (bytes) => {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += BLOCK_SIZE) chunks.push(bytes.subarray(offset, offset + BLOCK_SIZE));
  return chunks;
};

// ------------------------------------------------------------------ memory
export class MemoryHeldCache {
  constructor() {
    this.blobs = new Map();
    this.index = new Map();
  }

  /** Where the bytes are kept, for the message that names it. */
  location() { return "the runner's memory"; }

  async put(key, cid, bytes, digest) {
    this.blobs.set(cid, bytes);
    this.index.set(key, entryOf(key, cid, bytes.length, digest));
  }

  async get(key) { return this.index.get(key) || null; }

  async byCid(cid) { return Array.from(this.index.values()).find((e) => e.cid === cid) || null; }

  async entries() { return Array.from(this.index.values()); }

  async* read(cid) {
    const bytes = this.blobs.get(cid);
    if (!bytes) throw new HeldCacheError(`${cid} is not held`);
    for (const chunk of chunksOf(bytes)) yield chunk;
  }

  async markUploaded(cid) {
    for (const entry of this.index.values()) if (entry.cid === cid) entry.uploaded = true;
  }

  async release(cid) {
    this.blobs.delete(cid);
    for (const [key, entry] of this.index) if (entry.cid === cid) this.index.delete(key);
  }

  async clear() {
    this.blobs.clear();
    this.index.clear();
  }
}

// -------------------------------------------------------------------- node
export class FileHeldCache {
  constructor(directory = null) {
    this.directory = directory;
    this.modules = null;
  }

  location() { return this.directory || '~/.ethernity-cloud/held'; }

  async _open() {
    if (this.modules) return this.modules;
    // Loaded here, not at the module's top: the runner is bundled for
    // browsers too, where these modules do not exist and this store is never
    // chosen; the comments keep bundlers from resolving the names.
    const fs = await import(/* webpackIgnore: true */ /* @vite-ignore */ 'node:fs/promises');
    const path = await import(/* webpackIgnore: true */ /* @vite-ignore */ 'node:path');
    const os = await import(/* webpackIgnore: true */ /* @vite-ignore */ 'node:os');
    if (!this.directory) this.directory = path.join(os.homedir(), '.ethernity-cloud', 'held');
    try {
      await fs.mkdir(this.directory, { recursive: true });
    } catch (e) {
      throw new HeldCacheError(`the held cache directory ${this.directory} cannot be made: ${e.message}`);
    }
    this.modules = { fs, path };
    return this.modules;
  }

  _file(cid) { return this.modules.path.join(this.directory, `${cid}.bin`); }

  async _readIndex() {
    const { fs, path } = await this._open();
    try {
      return JSON.parse(await fs.readFile(path.join(this.directory, 'index.json'), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw new HeldCacheError(`the held cache index cannot be read: ${e.message}`);
    }
  }

  async _writeIndex(index) {
    const { fs, path } = await this._open();
    const file = path.join(this.directory, 'index.json');
    await fs.writeFile(`${file}.tmp`, JSON.stringify(index));
    await fs.rename(`${file}.tmp`, file);
  }

  async put(key, cid, bytes, digest) {
    const { fs } = await this._open();
    try {
      await fs.writeFile(this._file(cid), bytes);
    } catch (e) {
      throw new HeldCacheError(`${this.directory} cannot keep ${bytes.length} bytes: ${e.message}`);
    }
    const index = await this._readIndex();
    index[key] = entryOf(key, cid, bytes.length, digest);
    await this._writeIndex(index);
  }

  async get(key) { return (await this._readIndex())[key] || null; }

  async byCid(cid) { return Object.values(await this._readIndex()).find((e) => e.cid === cid) || null; }

  async entries() { return Object.values(await this._readIndex()); }

  async* read(cid) {
    const { fs } = await this._open();
    let handle;
    try {
      handle = await fs.open(this._file(cid), 'r');
    } catch (e) {
      throw new HeldCacheError(`${cid} is not held: ${e.message}`);
    }
    try {
      for (;;) {
        const buffer = new Uint8Array(BLOCK_SIZE);
        // eslint-disable-next-line no-await-in-loop
        const { bytesRead } = await handle.read(buffer, 0, BLOCK_SIZE, null);
        if (bytesRead === 0) break;
        yield buffer.subarray(0, bytesRead);
      }
    } finally {
      await handle.close();
    }
  }

  async markUploaded(cid) {
    const index = await this._readIndex();
    for (const entry of Object.values(index)) if (entry.cid === cid) entry.uploaded = true;
    await this._writeIndex(index);
  }

  async release(cid) {
    const { fs } = await this._open();
    const index = await this._readIndex();
    for (const [key, entry] of Object.entries(index)) if (entry.cid === cid) delete index[key];
    await this._writeIndex(index);
    try {
      await fs.unlink(this._file(cid));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new HeldCacheError(`${cid} could not be removed: ${e.message}`);
    }
  }

  async clear() {
    for (const entry of await this.entries()) await this.release(entry.cid); // eslint-disable-line no-await-in-loop
  }
}

// ----------------------------------------------------------------- browser
const DB_NAME = 'ethernity-cloud-runner';
const CHUNKS = 'chunks';
const INDEX = 'index';

const awaitRequest = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const awaitTransaction = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('the transaction was aborted'));
});

export class IndexedDbHeldCache {
  constructor(factory = globalThis.indexedDB) {
    this.factory = factory;
    this.db = null;
    this.persistenceAsked = false;
  }

  location() { return "the browser's IndexedDB (database ethernity-cloud-runner)"; }

  async _open() {
    if (this.db) return this.db;
    const req = this.factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ['cid', 'index'] });
      if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: 'key' });
    };
    this.db = await awaitRequest(req);
    if (!this.persistenceAsked && globalThis.navigator && globalThis.navigator.storage && globalThis.navigator.storage.persist) {
      this.persistenceAsked = true;
      globalThis.navigator.storage.persist().catch(() => {});
    }
    return this.db;
  }

  async put(key, cid, bytes, digest) {
    const db = await this._open();
    const tx = db.transaction([CHUNKS, INDEX], 'readwrite');
    const chunks = tx.objectStore(CHUNKS);
    chunksOf(bytes).forEach((chunk, index) => chunks.put({ cid, index, bytes: chunk }));
    tx.objectStore(INDEX).put(entryOf(key, cid, bytes.length, digest));
    try {
      await awaitTransaction(tx);
    } catch (e) {
      const quota = e && e.name === 'QuotaExceededError';
      throw new HeldCacheError(quota
        ? `the browser refused to store ${bytes.length} bytes in IndexedDB (quota); connect an IPFS endpoint or save the data`
        : `IndexedDB could not keep ${bytes.length} bytes: ${e && e.message ? e.message : e}`);
    }
  }

  async get(key) {
    const db = await this._open();
    return (await awaitRequest(db.transaction(INDEX).objectStore(INDEX).get(key))) || null;
  }

  async entries() {
    const db = await this._open();
    return awaitRequest(db.transaction(INDEX).objectStore(INDEX).getAll());
  }

  async byCid(cid) { return (await this.entries()).find((e) => e.cid === cid) || null; }

  async* read(cid) {
    const db = await this._open();
    for (let index = 0; ; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const record = await awaitRequest(db.transaction(CHUNKS).objectStore(CHUNKS).get([cid, index]));
      if (!record) {
        if (index === 0) throw new HeldCacheError(`${cid} is not held`);
        return;
      }
      yield record.bytes;
    }
  }

  async markUploaded(cid) {
    const db = await this._open();
    const tx = db.transaction(INDEX, 'readwrite');
    const store = tx.objectStore(INDEX);
    for (const entry of await awaitRequest(store.getAll())) {
      if (entry.cid === cid) store.put({ ...entry, uploaded: true });
    }
    await awaitTransaction(tx);
  }

  async release(cid) {
    const db = await this._open();
    const tx = db.transaction([CHUNKS, INDEX], 'readwrite');
    const index = tx.objectStore(INDEX);
    for (const entry of await awaitRequest(index.getAll())) if (entry.cid === cid) index.delete(entry.key);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([cid, 0], [cid, Number.MAX_SAFE_INTEGER]));
    await awaitTransaction(tx);
  }

  async clear() {
    const db = await this._open();
    const tx = db.transaction([CHUNKS, INDEX], 'readwrite');
    tx.objectStore(CHUNKS).clear();
    tx.objectStore(INDEX).clear();
    await awaitTransaction(tx);
  }
}

// --------------------------------------------------------------- selection
let configured = { directory: null };
let instance = null;

/** The store the runner holds artefacts in, by environment (see the module
    comment); the same instance for the process. */
export const openHeldCache = () => {
  if (instance) return instance;
  if (typeof globalThis.indexedDB !== 'undefined' && typeof globalThis.IDBKeyRange !== 'undefined') {
    instance = new IndexedDbHeldCache();
  } else if (globalThis.process && globalThis.process.versions && globalThis.process.versions.node) {
    instance = new FileHeldCache(configured.directory);
  } else {
    instance = new MemoryHeldCache();
  }
  return instance;
};

/** Node only: the directory the file store keeps artefacts in (default
    ~/.ethernity-cloud/held). Takes effect for the stores opened after it. */
export const configureHeldCache = ({ directory = null } = {}) => {
  configured = { directory };
  instance = null;
};
