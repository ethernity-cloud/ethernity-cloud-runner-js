import { ethers } from 'ethers';
import * as ipfsClient from './ipfs.js';
import { decryptWithPrivateKey, encryptWithCertificate, sha256 } from './crypto.js';
import { delay } from './utils.js';

/**
 * Interactive session handle -- created by runner.runSession() /
 * attachSession(). Wraps one running session order:
 *
 *   const session = await runner.runSession(resources, enclave, code);
 *   const seq = await session.sendInput('hello');   // etny-si row + IPFS
 *   const [msg] = await session.waitOutputs(1);     // verified etny-so row
 *   const final = await session.close();            // close row -> summary
 *
 * Trust model, mirrored from the enclave side: inputs are transactions from
 * THIS wallet (the contract only accepts the data owner) carrying the
 * ciphertext digest; every output row's signature is verified against
 * order.dproc -- the task wallet the enclave anchored on-chain -- BEFORE its
 * payload is fetched, digest-checked, decrypted and delivered; liveness
 * derives from chain state alone.
 */

export const SESSION_INPUT_KEY = 'etny-si';
export const SESSION_OUTPUT_KEY = 'etny-so';
export const SESSION_WIRE_VERSION = 'v1';
export const MAX_SESSION_MESSAGES = 256;
// Mirror of the enclave's input-acceptance margin (M3): sending inside this
// window would only earn a signed 'late' notice, so refuse client-side.
export const SEND_CUTOFF_SECONDS = 600;

export class SessionError extends Error {}

// Codes carried by 'error' output rows (msg.code): task codes for payload
// failures (5 = no ___etny_on_input___ handler defined, 1 = handler raised)
// and session notices 50-53 (malformed row, out-of-order seq, undecryptable
// input, securelock build without session support). 0 for ok/late rows.
export const SESSION_ERROR_CODE_NAMES = {
  1: 'handler-error',
  5: 'handler-not-defined',
  50: 'input-malformed',
  51: 'input-out-of-order',
  52: 'input-undecryptable',
  53: 'unsupported-securelock',
};

export class EthernityCloudSession {
  constructor(runner, orderId) {
    this.runner = runner;
    this.orderId = Number(orderId);
    this.rowsSeen = 0;
    this.outputs = [];
    this.closed = false;
  }

  static async create(runner, orderId) {
    const session = new EthernityCloudSession(runner, orderId);
    const contract = runner.protocolContract.getContract();
    const order = await contract._getOrder(session.orderId);
    session.doReq = Number(order[2]);
    session.dpReq = Number(order[3]);
    const doreq = await contract._getDORequest(session.doReq);
    session.durationHours = Number(doreq[5]);
    session.startedAt = Date.now();
    session.deadline = session.startedAt + session.durationHours * 3600 * 1000;
    session.inputSeq = await session._countMyInputs();
    return session;
  }

  _contract() {
    return this.runner.protocolContract.getContract();
  }

  /** Resume seq from chain state so a reattached session continues exactly
      where the previous process stopped. */
  async _countMyInputs() {
    let count;
    try {
      count = Number(await this._contract()._getMetadataCountForRequest(this.doReq));
    } catch (e) {
      return 0;
    }
    let seq = 0;
    for (let i = 0; i < count; i++) {
      let key; let value;
      try {
        [key, value] = await this._contract()._getMetadataValueForRequest(this.doReq, i);
      } catch (e) { break; }
      if (key !== SESSION_INPUT_KEY) continue;
      const parts = String(value || '').split(':');
      if (parts.length === 5 && parts[0] === SESSION_WIRE_VERSION &&
          Number(parts[2]) === this.orderId && Number.isFinite(Number(parts[1]))) {
        seq = Math.max(seq, Number(parts[1]) + 1);
      }
    }
    return seq;
  }

  /** order.dproc: the enclave task wallet, anchored on-chain by
      _addProcessorToOrder -- the signature authority for output rows. */
  async _taskWallet() {
    const order = await this._contract()._getOrder(this.orderId);
    return String(order[1]);
  }

  /* ------------------------------------------------------------------ status */

  remainingSeconds() {
    return Math.max(0, Math.floor((this.deadline - Date.now()) / 1000));
  }

  async isRunning() {
    if (this.closed) return false;
    let status;
    try {
      status = Number((await this._contract()._getOrder(this.orderId))[4]);
    } catch (e) { return false; }
    return status === 1 && Date.now() < this.deadline;
  }

  async getStatus() {
    let status = -1;
    try {
      status = Number((await this._contract()._getOrder(this.orderId))[4]);
    } catch (e) { /* unreadable */ }
    const acked = this.outputs.filter((o) => o.ack >= 0).map((o) => o.ack);
    return {
      orderId: this.orderId,
      running: status === 1 && Date.now() < this.deadline,
      orderStatus: status,
      remainingSeconds: this.remainingSeconds(),
      inputsSent: this.inputSeq,
      lastAckedInput: acked.length ? Math.max(...acked) : -1,
      outputsReceived: this.outputs.length,
    };
  }

  /* ------------------------------------------------------------------- input */

  /** Encrypt for the enclave, pin to IPFS, commit the etny-si row. Returns
      the input seq. Refuses when the session cannot answer any more. */
  async sendInput(data) {
    if (this.closed) throw new SessionError('session is closed');
    if (this.inputSeq >= MAX_SESSION_MESSAGES) {
      throw new SessionError(`session input cap reached (${MAX_SESSION_MESSAGES})`);
    }
    if (this.remainingSeconds() <= SEND_CUTOFF_SECONDS) {
      throw new SessionError(
        'session is inside its shutdown window -- the enclave would only ' +
        'answer with a timeout notice; not sending');
    }
    if (!await this.isRunning()) {
      throw new SessionError('session order is no longer processing');
    }
    const ciphertext = await encryptWithCertificate(String(data), this.runner.enclavePublicKey);
    const cid = await ipfsClient.uploadToIPFS(ciphertext);
    if (!cid || cid === 'null') throw new SessionError('could not pin the input to IPFS');
    const digest = sha256(ciphertext);
    const value = `${SESSION_WIRE_VERSION}:${this.inputSeq}:${this.orderId}:${cid}:${digest}`;
    const tx = await this._contract()._addMetadataToRequest(this.doReq, SESSION_INPUT_KEY, value);
    await tx.wait();
    const seq = this.inputSeq;
    this.inputSeq += 1;
    this.runner.dispatchECEvent(`Session input ${seq} committed (${cid})`);
    return seq;
  }

  /* ------------------------------------------------------------------ output */

  /** Read new etny-so rows, verify each signature against the on-chain task
      wallet, fetch + digest-check + decrypt the payload. Returns only the
      NEW verified messages (also appended to this.outputs). */
  async pollOutputs() {
    let count;
    try {
      count = Number(await this._contract()._getMetadataCountForDPRequest(this.dpReq));
    } catch (e) { return []; }
    const fresh = [];
    while (this.rowsSeen < count) {
      const i = this.rowsSeen;
      let key; let value;
      try {
        [key, value] = await this._contract()._getMetadataValueForDPRequest(this.dpReq, i);
      } catch (e) { break; }
      this.rowsSeen = i + 1;
      if (key !== SESSION_OUTPUT_KEY) continue;
      const msg = await this._verifyOutputRow(String(value || ''));
      if (msg !== null) {
        this.outputs.push(msg);
        fresh.push(msg);
      }
    }
    return fresh;
  }

  async _verifyOutputRow(value) {
    const parts = value.split(':');
    if (parts.length !== 9 || parts[0] !== SESSION_WIRE_VERSION) return null;
    const seq = Number(parts[1]);
    const rowOrder = Number(parts[2]);
    const ack = Number(parts[3]);
    const code = Number(parts[5]);
    const [status, cid, shaHex, sig] = [parts[4], parts[6], parts[7].toLowerCase(), parts[8]];
    if (!Number.isFinite(seq) || !Number.isFinite(code) || rowOrder !== this.orderId) return null;
    const message = `etny-so|${this.orderId}|${seq}|${ack}|${status}|${code}|${cid}|${shaHex}`;
    let signer;
    try {
      signer = ethers.utils.verifyMessage(message, sig);
    } catch (e) {
      this.runner.dispatchECEvent(`Session output ${seq}: bad signature encoding`, 2);
      return null;
    }
    const taskWallet = await this._taskWallet();
    if (signer.toLowerCase() !== taskWallet.toLowerCase()) {
      this.runner.dispatchECEvent(
        `Session output ${seq}: signature by ${signer}, expected the task wallet ` +
        `${taskWallet} -- DISCARDING (operator forgery?)`, 2);
      return null;
    }
    const msg = { seq, ack, status, code, data: null };
    if (!cid) return msg; // signed notice row without payload (late)
    // 'ok' rows carry the reply; 'error' rows carry an encrypted explanation
    // of why the input was not processed -- fetch both.
    try {
      const content = await ipfsClient.getFromIPFS(cid);
      if (sha256(content) !== shaHex) {
        this.runner.dispatchECEvent(
          `Session output ${seq}: content does not match the signed digest -- DISCARDING`, 2);
        return null;
      }
      const decrypted = await decryptWithPrivateKey(
        content,
        this.runner.tokenContract.getCurrentWallet(),
        this.runner.walletContext ? this.runner.walletContext.privateKey : null
      );
      if (!decrypted.success) {
        this.runner.dispatchECEvent(`Session output ${seq}: could not decrypt`, 2);
        return null;
      }
      msg.data = decrypted.data;
    } catch (e) {
      this.runner.dispatchECEvent(`Session output ${seq}: payload not readable yet (${e.message})`, 2);
      return null;
    }
    return msg;
  }

  /** Block until `count` new verified outputs arrive (or timeout). */
  async waitOutputs(count = 1, timeoutMs = 300000, pollMs = 5000) {
    const collected = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && collected.length < count) {
      collected.push(...await this.pollOutputs());
      if (collected.length >= count) break;
      await delay(pollMs);
    }
    return collected;
  }

  /** Poll in the background, invoking callback per verified message, until
      the session leaves PROCESSING. Returns a stop() function. */
  onOutput(callback, pollMs = 5000) {
    let stopped = false;
    (async () => {
      while (!stopped && await this.isRunning()) {
        for (const msg of await this.pollOutputs()) {
          try { callback(msg); } catch (e) {
            this.runner.dispatchECEvent(`Session output callback failed: ${e.message}`, 2);
          }
        }
        await delay(pollMs);
      }
    })();
    return () => { stopped = true; };
  }

  /* ------------------------------------------------------------------- close */

  /** Commit the close row; optionally wait for settlement and return the
      final task result (the session summary). */
  async close(wait = true, timeoutMs = 900000) {
    if (!this.closed) {
      const value = `${SESSION_WIRE_VERSION}:close:${this.orderId}`;
      const tx = await this._contract()._addMetadataToRequest(this.doReq, SESSION_INPUT_KEY, value);
      await tx.wait();
      this.closed = true;
      this.runner.dispatchECEvent(`Session close requested for order ${this.orderId}`);
    }
    if (!wait) return null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const status = Number((await this._contract()._getOrder(this.orderId))[4]);
        if (status !== 1) break;
      } catch (e) { /* transient read failure */ }
      await this.pollOutputs();
      await delay(5000);
    }
    await this.pollOutputs();
    try {
      this.runner.orderId = this.orderId;
      const result = await this.runner.getResultFromOrder();
      return result;
    } catch (e) {
      this.runner.dispatchECEvent(`Session final result not readable: ${e.message}`, 2);
      return null;
    }
  }
}
