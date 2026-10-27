// heldCache.js: the three stores keep an artefact by CID in BLOCK_SIZE chunks
// under its artefact key, give it back in chunks, mark it uploaded, release
// it, and the file store survives a new instance (a new process). The browser
// store runs on fake-indexeddb here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { FileHeldCache, IndexedDbHeldCache, MemoryHeldCache, HeldCacheError } from '../heldCache.js';
import { BLOCK_SIZE } from '../ipfs.js';

globalThis.IDBKeyRange = IDBKeyRange;

const CID = 'bafkreibobnv5ikag6zekcsihz2nsckfjg32uacwd3o6shtu3u7rxi3ot2m';
const OTHER = 'bafkreifgxs3pym3dkwr3uuio75l56jooxni3joe7vqcgb7jtjdguhirhle';

const collect = async (chunks) => {
  const out = [];
  for await (const chunk of chunks) out.push(chunk);
  return out;
};

const exercise = async (cache) => {
  const bytes = new Uint8Array(BLOCK_SIZE + 10).fill(7);
  await cache.put('key-a', CID, bytes, 'digest-a');
  await cache.put('key-b', OTHER, new Uint8Array([1, 2, 3]), 'digest-b');
  assert.deepEqual((await cache.get('key-a')) && { cid: (await cache.get('key-a')).cid, size: (await cache.get('key-a')).size, digest: (await cache.get('key-a')).digest, uploaded: (await cache.get('key-a')).uploaded },
    { cid: CID, size: BLOCK_SIZE + 10, digest: 'digest-a', uploaded: false });
  assert.equal((await cache.byCid(OTHER)).key, 'key-b');
  assert.equal(await cache.get('key-none'), null);
  const chunks = await collect(cache.read(CID));
  assert.deepEqual(chunks.map((c) => c.length), [BLOCK_SIZE, 10]);
  assert.equal(chunks[1][9], 7);
  await cache.markUploaded(CID);
  assert.equal((await cache.get('key-a')).uploaded, true);
  assert.equal((await cache.get('key-b')).uploaded, false);
  await cache.release(CID);
  assert.equal(await cache.get('key-a'), null);
  assert.equal(await cache.byCid(CID), null);
  await assert.rejects(collect(cache.read(CID)), HeldCacheError);
  assert.deepEqual((await cache.entries()).map((e) => e.cid), [OTHER]);
  await cache.clear();
  assert.deepEqual(await cache.entries(), []);
};

test('the memory store', async () => {
  await exercise(new MemoryHeldCache());
});

test('the file store, and its index survives a new instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'etny-held-'));
  try {
    await exercise(new FileHeldCache(directory));
    const first = new FileHeldCache(directory);
    await first.put('key-c', CID, new Uint8Array([9, 9]), 'digest-c');
    const second = new FileHeldCache(directory);
    assert.equal((await second.get('key-c')).cid, CID);
    assert.deepEqual((await collect(second.read(CID))).map((c) => Array.from(c)), [[9, 9]]);
    assert.ok((await readdir(directory)).includes(`${CID}.bin`));
    await second.release(CID);
    assert.ok(!(await readdir(directory)).includes(`${CID}.bin`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the browser store, on IndexedDB', async () => {
  await exercise(new IndexedDbHeldCache(indexedDB));
});
