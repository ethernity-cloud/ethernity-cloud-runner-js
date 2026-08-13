/**
 * Structured result envelopes + the runner-managed ESR state cache.
 *
 * The enclave executor returns results as a structured envelope:
 *   { ecld: 1, type: 'json'|'text'|'base64', data: ..., esr: {...}|null }
 *
 * parseResultEnvelope decodes it (legacy raw-string results pass through),
 * exposing both the typed view and a legacy string view so existing dApp code
 * that treats results as strings keeps working.
 *
 * StateCache stores the ESR state carried by result envelopes, keyed by
 * (enclave wallet, state key). The runner auto-populates it from every result
 * and gates reads behind a free on-chain check (getState eth_call): while the
 * cached version is current, a read costs zero orders and zero gas.
 */

const b64decode = (s) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

export function parseResultEnvelope(raw) {
  const out = {
    isEnvelope: false,
    type: 'text',
    data: raw,
    esr: null,
    raw,
    legacy: raw,
  };
  if (typeof raw !== 'string' || !raw.trimStart().startsWith('{')) return out;
  let env;
  try {
    env = JSON.parse(raw);
  } catch (e) {
    return out;
  }
  if (!env || typeof env !== 'object' || env.ecld !== 1) return out;
  out.isEnvelope = true;
  out.esr = env.esr || null;
  const rtype = env.type || 'text';
  const rdata = env.data;
  if (rtype === 'base64') {
    try {
      out.type = 'base64';
      out.data = b64decode(rdata || '');
      out.legacy = rdata || '';
    } catch (e) {
      out.type = 'text';
      out.data = rdata;
      out.legacy = String(rdata);
    }
  } else if (rtype === 'json') {
    out.type = 'json';
    out.data = rdata;
    out.legacy = JSON.stringify(rdata);
  } else {
    out.type = 'text';
    out.data = rdata == null ? '' : String(rdata);
    out.legacy = out.data;
  }
  return out;
}

/** localStorage-backed store (browser). */
class LocalStorageBackend {
  constructor(prefix = 'ecld-esr-cache:') {
    this.prefix = prefix;
  }

  get(k) {
    const v = window.localStorage.getItem(this.prefix + k);
    return v ? JSON.parse(v) : undefined;
  }

  set(k, v) {
    window.localStorage.setItem(this.prefix + k, JSON.stringify(v));
  }

  delete(k) {
    window.localStorage.removeItem(this.prefix + k);
  }

  keys() {
    const out = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
    }
    return out;
  }
}

/** In-memory store (Node, or browser without persistence). */
class MemoryBackend {
  constructor() {
    this.map = new Map();
  }

  get(k) {
    return this.map.get(k);
  }

  set(k, v) {
    this.map.set(k, v);
  }

  delete(k) {
    this.map.delete(k);
  }

  keys() {
    return [...this.map.keys()];
  }
}

export class StateCache {
  /**
   * backend: any { get(k), set(k,v), delete(k), keys() } store. Defaults to
   * localStorage in the browser and an in-memory Map under Node.
   */
  constructor(backend = null) {
    if (backend) {
      this.backend = backend;
    } else if (typeof window !== 'undefined' && window.localStorage) {
      this.backend = new LocalStorageBackend();
    } else {
      this.backend = new MemoryBackend();
    }
  }

  static key(wallet, key) {
    return `${(wallet || '').toLowerCase()}|${key}`;
  }

  get(wallet, key) {
    const e = this.backend.get(StateCache.key(wallet, key));
    return e ? { ...e } : null;
  }

  set(wallet, key, state, version, cid) {
    this.backend.set(StateCache.key(wallet, key), {
      state,
      version: Number(version),
      cid,
      wallet,
      savedAt: Math.floor(Date.now() / 1000),
    });
  }

  invalidate(wallet, key) {
    this.backend.delete(StateCache.key(wallet, key));
  }

  clear() {
    for (const k of this.backend.keys()) this.backend.delete(k);
  }
}
