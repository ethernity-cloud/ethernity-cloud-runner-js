import { ethers } from 'ethers';
import esrAbi from '../abi/esrAbi.js';

/**
 * Read-only client for the Enclave State Registry (ESR).
 *
 * Enclaves publish a pointer to their encrypted state here, one entry per
 * (enclave, key), with a monotonic version.
 *
 * ## What a client can and cannot see
 *
 * State is encrypted with a key derived from the ENCLAVE IDENTITY, so only that
 * enclave can decrypt it. This client therefore exposes METADATA only: the
 * version, when it last changed, and the pointer. That is deliberate -- state is
 * the payload's private working memory, and anything a dApp should see is
 * returned by a function the payload chooses to expose, rather than by making
 * the whole state readable.
 *
 * Useful things you can still do with metadata: prove state advanced (the
 * version bumped), show when it last changed, or wait for a task's effect to
 * land before re-rendering.
 */
class ESRContract {
  contract = null;

  provider = null;

  /**
   * @param {string} registryAddress deployed ESR address for this network
   * @param {object} walletContext   optional; falls back to window.ethereum
   */
  constructor(registryAddress, walletContext = null) {
    if (!registryAddress) {
      throw new Error('ESR registry address is required');
    }
    if (walletContext && walletContext.provider) {
      this.provider = walletContext.provider;
    } else {
      this.provider = new ethers.providers.Web3Provider(window.ethereum);
    }
    this.contract = new ethers.Contract(registryAddress, esrAbi, this.provider);
  }

  /**
   * keccak256 of the application key -- the bytes32 the contract is keyed by.
   * Must match what the enclave computes for the same key.
   */
  // eslint-disable-next-line class-methods-use-this
  keyHash(key) {
    return ethers.utils.id(key);
  }

  /** Current version for (enclave, key); 0 when never committed. */
  async getVersion(enclaveAddress, key) {
    const v = await this.contract.getVersion(enclaveAddress, this.keyHash(key));
    return Number(v);
  }

  /** True when this (enclave, key) has ever been committed. */
  async exists(enclaveAddress, key) {
    return this.contract.exists(enclaveAddress, this.keyHash(key));
  }

  /**
   * Last accepted idempotency nonce for (enclave, key); 0 when none.
   *
   * The nonce is PUBLIC on-chain data, recorded next to the version, so a
   * web3 client can learn the latest accepted value with one free eth_call
   * and pick the next one (any greater value; gaps are allowed) before
   * submitting a state-writing task with an idempotency guard. The chain
   * value is the primary source of truth; the copy inside the encrypted
   * state object is a reporting copy the enclave cross-checks against it.
   */
  async getNonce(enclaveAddress, key) {
    const n = await this.contract.getNonce(enclaveAddress, this.keyHash(key));
    return Number(n);
  }

  /**
   * Metadata for (enclave, key): { cid, version, updatedAt, valid }.
   *
   * `valid` reports whether the stored pointer actually looks like an IPFS CID.
   * The contract accepts any non-empty string, so a buggy enclave can commit
   * something that is not a CID -- callers must not feed such a value to IPFS,
   * where it can only error or retry-loop.
   */
  async getState(enclaveAddress, key) {
    const [cid, version, updatedAt] = await this.contract.getState(
      enclaveAddress,
      this.keyHash(key)
    );
    return {
      cid,
      version: Number(version),
      updatedAt: Number(updatedAt),
      valid: ESRContract.looksLikeCID(cid)
    };
  }

  /**
   * True only for values shaped like an IPFS CID.
   * CIDv0 is 46 chars starting "Qm"; CIDv1 is base32 starting "b".
   */
  static looksLikeCID(value) {
    const cid = (value || '').trim();
    if (!cid || cid.startsWith('0x')) return false;
    if (cid.startsWith('Qm') && cid.length === 46) return true;
    if (cid.startsWith('b') && cid.length >= 46 && cid === cid.toLowerCase()) return true;
    return false;
  }

  /**
   * Resolve once the version for (enclave, key) exceeds `afterVersion`.
   *
   * Lets a dApp wait for a task's state change to land before re-reading,
   * instead of guessing at a delay. Returns the new version, or null on timeout.
   */
  async waitForVersion(enclaveAddress, key, afterVersion, timeoutMs = 120000, pollMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      const version = await this.getVersion(enclaveAddress, key);
      if (version > afterVersion) return version;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return null;
  }
}

export default ESRContract;
