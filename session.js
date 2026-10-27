import { ethers } from 'ethers';
import * as ipfsClient from './ipfs.js';
import { decryptWithPrivateKey, encryptWithCertificate, sha256, verifyCertificateSignature } from './crypto.js';
import { delay, waitForReceipt, withGasHeadroom } from './utils.js';

/**
 * Interactive session handle -- created by runner.runSession() /
 * attachSession(). Wraps one running session order:
 *
 *   const session = await runner.runSession(resources, enclave, code);
 *   const seq = await session.sendInput('hello');   // input via storage + etny-si row
 *   const [msg] = await session.waitOutputs(1);     // verified etny-so row
 *   const final = await session.close();            // close row -> summary
 *
 * Trust model, mirrored from the enclave side: inputs are transactions from
 * THIS wallet (the contract only accepts the data owner) carrying the
 * ciphertext digest; every output row's signature is verified against the
 * task wallet the trustedzone attests in the session's 'etny-sw' row, signed
 * with the key of the certificate the Image Registry holds for it (the
 * certificate the challenge was sealed with) -- BEFORE its payload is
 * fetched, digest-checked, decrypted and delivered; liveness derives from
 * chain state alone.
 */

export const SESSION_INPUT_KEY = 'etny-si';
export const SESSION_OUTPUT_KEY = 'etny-so';
export const SESSION_WALLET_KEY = 'etny-sw';
export const SESSION_WIRE_VERSION = 'v1';
// An output row whose payload no endpoint serves yet, or serves under its CID
// with other bytes, is read again on later polls for this long before it is
// given up: the node pins the payload in the background and the gateway may
// lag the row.
export const PAYLOAD_RETRY_MS = 600000;
// _verifyOutputRow's answer for such a row.
const PAYLOAD_PENDING = Symbol('payload pending');
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
    // The task wallet the trustedzone attested in the session's 'etny-sw' row:
    // the signer every output row is checked against. null until that row has
    // been read and verified.
    this.attestedWallet = null;
    // Row index -> when its payload was first found not readable; the row is
    // retried until PAYLOAD_RETRY_MS after that.
    this.payloadWaits = {};
    // The owner's signature that lodges this session's inputs with the intake
    // before their rows (_lodgeInput): undefined until asked for, null when
    // the wallet refused to sign.
    this.ownerSignature = undefined;
  }

  static async create(runner, orderId) {
    const session = new EthernityCloudSession(runner, orderId);
    const contract = runner.protocolContract.getContract();
    // Retried: the order was placed moments ago (runner.readOrder).
    const order = await runner.readOrder(session.orderId);
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

  /** The task wallet the output rows are signed with: attested by the
      trustedzone in the session's 'etny-sw' row, signed with the key of the
      certificate the Image Registry holds for it. null until that row has
      been read and verified. */
  _taskWallet() {
    return this.attestedWallet;
  }

  /** Verify an 'etny-sw' row, 'v1:<orderId>:<taskWallet>:<sigDerHex>', against
      the trustedzone's certificate (the one the challenge was sealed with) and
      keep its wallet. A row that does not verify is ignored: a node cannot
      name the signer of this session's outputs. */
  _acceptWalletAttestation(value) {
    const parts = value.split(':');
    if (parts.length !== 4 || parts[0] !== SESSION_WIRE_VERSION || Number(parts[1]) !== this.orderId) return false;
    const [, , wallet, sig] = parts;
    const message = `${SESSION_WALLET_KEY}|${this.orderId}|${wallet}`;
    if (!verifyCertificateSignature(this.runner.enclavePublicKey, message, sig)) {
      this.runner.dispatchECEvent(
        `Session: the task wallet attestation of ${wallet} does not verify against the trustedzone's certificate -- IGNORING`, 1);
      return false;
    }
    if (this.attestedWallet !== null && this.attestedWallet.toLowerCase() !== wallet.toLowerCase()) {
      this.runner.dispatchECEvent(
        `Session: a second task wallet attestation (${wallet}) differs from the first (${this.attestedWallet}) -- IGNORING`, 1);
      return false;
    }
    this.attestedWallet = wallet;
    this.runner.dispatchECEvent(`Session: task wallet attested by the trustedzone: ${wallet}`);
    return true;
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

  /** Lodge input `cid`'s queued bytes with the intake before the row that
      names them, under the request owner's signature, asked of the wallet
      once per session (one prompt in a browser wallet). True when the intake
      took them. False when the bytes are to go after the row instead: no
      intake, no wallet, a wallet that did not sign, or an intake without the
      signed path (its 403 INTAKE_UNSIGNED_PATH). Throws when the intake
      refused the lodged bytes otherwise, or could not be reached: the row is
      not committed without its bytes in place, and the input can be sent
      again. */
  async _lodgeInput(cid) {
    const network = ipfsClient.intakeNetwork();
    if (network === null || !this.runner.walletContext) return false;
    if (this.ownerSignature === undefined) {
      try {
        this.ownerSignature = await this.runner.walletContext.signMessage(ipfsClient.ownerSignatureMessage(network, this.doReq));
      } catch (e) {
        this.ownerSignature = null;
        this.runner.dispatchECEvent(
          `Session: the wallet did not sign for lodging inputs before their rows (${e.message}); inputs go out after their rows`, 2);
      }
    }
    if (!this.ownerSignature) return false;
    const { delivered, refused } = await ipfsClient.deliverSigned(this.doReq, [cid], this.ownerSignature);
    if (delivered.includes(cid)) return true;
    if (String(refused[cid]).includes(ipfsClient.INTAKE_UNSIGNED_PATH)) {
      this.runner.dispatchECEvent(`Session input ${this.inputSeq}: the intake takes no lodged bytes; delivered after its row`, 2);
      return false;
    }
    throw new SessionError(`input ${this.inputSeq} was not lodged with the intake (${refused[cid]}); not committed, send it again`);
  }

  /** Encrypt for the enclave, deliver the ciphertext through the configured
      storage (the bootnode's intake by default), commit the etny-si row.
      Returns the input seq. Refuses when the session cannot answer any more. */
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
    // The ciphertext's CID through the configured storage; uploadToIPFS throws
    // when the storage does not take it.
    const cid = await this.runner._uploadArtefact(ciphertext);
    // The bytes reach the intake before the row that names them, under the
    // owner's signature; an input is complete only once its row is on chain,
    // so a client that stops before that leaves no row without bytes.
    const lodged = await this._lodgeInput(cid);
    const digest = sha256(ciphertext);
    const value = `${SESSION_WIRE_VERSION}:${this.inputSeq}:${this.orderId}:${cid}:${digest}`;
    const tx = await withGasHeadroom(this._contract()._addMetadataToRequest, [this.doReq, SESSION_INPUT_KEY, value]);
    await waitForReceipt(this.runner.protocolContract.getProvider(), tx.hash);
    if (!lodged) await ipfsClient.flushPending(this.doReq, [cid]);
    const seq = this.inputSeq;
    this.inputSeq += 1;
    this.runner.dispatchECEvent(`Session input ${seq} committed (${cid})`);
    return seq;
  }

  /* ------------------------------------------------------------------ output */

  /** Read new rows: the 'etny-sw' row attests the task wallet, each 'etny-so'
      row is verified against it, its payload fetched, digest-checked and
      decrypted. Returns only the NEW verified messages (also appended to
      this.outputs). An output row before any attestation is discarded: its
      signer cannot be checked. A verified row whose payload is not readable
      yet is kept, and the rows after it with it, for the next poll, up to
      PAYLOAD_RETRY_MS. */
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
      if (key === SESSION_WALLET_KEY) {
        this._acceptWalletAttestation(String(value || ''));
        this.rowsSeen = i + 1;
        continue;
      }
      if (key !== SESSION_OUTPUT_KEY) {
        this.rowsSeen = i + 1;
        continue;
      }
      if (this.attestedWallet === null) {
        this.rowsSeen = i + 1;
        this.runner.dispatchECEvent(
          `Session: output row ${i} precedes the task wallet attestation; its signer cannot be checked -- DISCARDING`, 1);
        continue;
      }
      let msg = await this._verifyOutputRow(String(value || ''));
      if (msg === PAYLOAD_PENDING) {
        if (!(i in this.payloadWaits)) this.payloadWaits[i] = Date.now();
        const waited = Date.now() - this.payloadWaits[i];
        if (waited < PAYLOAD_RETRY_MS) break;
        this.runner.dispatchECEvent(
          `Session output row ${i}: payload not readable in ${Math.round(waited / 1000)} s -- DISCARDING`, 1);
        msg = null;
      }
      this.rowsSeen = i + 1;
      delete this.payloadWaits[i];
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
      signer = ethers.verifyMessage(message, sig);
    } catch (e) {
      this.runner.dispatchECEvent(`Session output ${seq}: bad signature encoding`, 2);
      return null;
    }
    const taskWallet = this._taskWallet();
    if (taskWallet === null || signer.toLowerCase() !== taskWallet.toLowerCase()) {
      this.runner.dispatchECEvent(
        `Session output ${seq}: signature by ${signer}, expected the attested task wallet ` +
        `${taskWallet} -- DISCARDING (operator forgery?)`, 2);
      return null;
    }
    const msg = { seq, ack, status, code, data: null };
    if (!cid) return msg; // signed notice row without payload (late)
    // 'ok' rows carry the reply; 'error' rows carry an encrypted explanation
    // of why the input was not processed -- fetch both.
    let content;
    try {
      content = await this._fetchPayload(cid);
    } catch (e) {
      this.runner.dispatchECEvent(`Session output ${seq}: payload not readable yet (${e.message})`, 2);
      return PAYLOAD_PENDING;
    }
    if (sha256(content) !== shaHex) {
      this.runner.dispatchECEvent(`Session output ${seq}: payload not served under its CID yet; retrying`, 2);
      return PAYLOAD_PENDING;
    }
    const decrypted = await this._decryptPayload(content);
    if (!decrypted.success) {
      this.runner.dispatchECEvent(`Session output ${seq}: could not decrypt -- DISCARDING`, 2);
      return null;
    }
    msg.data = decrypted.data;
    return msg;
  }

  /** The bytes an output row's CID names, in one round over the endpoints;
      throws when none served them. */
  async _fetchPayload(cid) {
    return ipfsClient.getFromIPFS(cid, Date.now());
  }

  /** The payload decrypted with this wallet's key: { success, data }. */
  _decryptPayload(content) {
    return decryptWithPrivateKey(
      content,
      this.runner.tokenContract.getCurrentWallet(),
      this.runner.walletContext ? this.runner.walletContext.privateKey : null
    );
  }

  /** The verified output answering input `seq` (the row whose ack is `seq`;
      an 'ok' reply, or an 'error' or 'late' notice), polled for until it
      arrives or `timeoutMs` passes: null then. Outputs answering other
      inputs that arrive meanwhile stay in this.outputs. This is the wait for
      a request-reply exchange; waitOutputs returns any new output, so there
      a late answer to an earlier input would be taken for the current one's. */
  async awaitOutput(seq, timeoutMs = 300000, pollMs = 5000) {
    const answer = () => this.outputs.find((m) => m.ack === seq) || null;
    const deadline = Date.now() + timeoutMs;
    while (answer() === null && Date.now() < deadline) {
      await this.pollOutputs();
      if (answer() === null) await delay(pollMs);
    }
    return answer();
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
      const tx = await withGasHeadroom(this._contract()._addMetadataToRequest, [this.doReq, SESSION_INPUT_KEY, value]);
      await waitForReceipt(this.runner.protocolContract.getProvider(), tx.hash);
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
