import { ethers } from 'ethers';
import * as ipfsClient from './ipfs.js';
import {
  delay,
  formatDate,
  generateRandomHexOfSize,
  generateWallet,
  isAddress,
  isNullOrEmpty,
  parseTransactionBytes
} from './utils.js';
import { decryptWithPrivateKey, encryptWithCertificate, sha256 } from './crypto.js';
import { resolveWalletContext } from './walletContext.js';
import EtnyContract from './contract/operation/etnyContract.js';
import EcldContract from './contract/operation/ecldContract.js';
import ImageRegistryContract from './contract/operation/imageRegistryContract.js';
import ESRContract from './contract/operation/esrContract.js';
import { StateCache, parseResultEnvelope } from './stateCache.js';
import contractBloxberg from './contract/abi/etnyAbi.js';
import protocolContractPolygon from './contract/abi/polygonProtocolAbi.js';
import {
  ECEvent,
  ECStatus,
  ECLog,
  ECOrderTaskStatus,
  ZERO_CHECKSUM,
  ECAddress,
  ECError,
  ECRunner,
  resolveNetworkConfig,
  taskStatusName,
  isOperatorFaultCode
} from './enums.js';
import PolygonProtocolContract from './contract/operation/polygonProtocolContract.js';
import BloxbergProtocolContract from './contract/operation/bloxbergProtocolContract.js';
import { Buffer } from 'buffer';

// Deep, browser-safe object dump for DEBUG events. Replaces node's util.inspect
// so the runner no longer pulls in the `util` polyfill — that polyfill does
// bare `process.env.NODE_DEBUG` / `process.pid` accesses that crash in non-Node
// bundles (browsers without a process shim). Handles the two things a plain
// JSON.stringify chokes on here: bigints and circular refs (ethers tx/receipt
// objects). Mirrors `util.inspect(x, {depth: null})` closely enough for a debug
// log line.
const inspect = (value) => {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'bigint') return `${val}n`;
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      },
      2
    );
  } catch (e) {
    return String(value);
  }
};

const LAST_BLOCKS = 20;
const VERSION = 'v3';
// Fallback IPFS endpoint used when the app did not call initializeStorage()
// before run(); prevents "Cannot read properties of null (reading 'add')".
// Plain HTTPS on the default port (443), no custom port.
const DEFAULT_IPFS_ADDRESS = 'https://ipfs.ethernity.cloud';

class EthernityCloudRunner extends EventTarget {
  constructor(networkAddress = ECAddress.BLOXBERG.TESTNET_ADDRESS, walletOptions = {}, chainId = undefined) {
    super();
    this.networkAddress = networkAddress;
    // LOCAL mode: run tasks against the SDK's local test API (`ecld-test
    // serve`) instead of the blockchain. Same runner surface — run(), events,
    // getResult() — no wallet, no gas, no SGX. Endpoint override:
    // new EthernityCloudRunner('LOCAL', { localEndpoint: 'http://...' }).
    this.localMode = networkAddress === 'LOCAL';
    if (this.localMode) {
      this.localEndpoint = ((walletOptions && walletOptions.localEndpoint) ||
        'http://127.0.0.1:8745').replace(/\/$/, '');
      this.resetState();
      return;
    }
    // Optional disambiguator for the ECLD-family testnets (IoTeX / Sepolia /
    // LitVM) that share a token address. When omitted, it is resolved from the
    // wallet provider's chainId in resolveNetworkContext() before the run.
    this.chainId = chainId;
    // Resolve the wallet once (raw privateKey / injected signer / provider, or
    // MetaMask via window.ethereum when no options are given) and share it with
    // every contract so they all talk to the same chain and wallet. We do NOT
    // retain the raw walletOptions on the instance so the private key isn't
    // exposed as an extra, easily-serialisable field on the runner.
    this.walletContext = resolveWalletContext(networkAddress, walletOptions || {});
    this.initializeContracts();
    this.resetState();
    // An explicit encryption public key (or one derived from a raw private key)
    // lets us skip the MetaMask-only eth_getEncryptionPublicKey call.
    if (this.walletContext.encryptionPublicKey) {
      this.publicKey = this.walletContext.encryptionPublicKey;
    }
  }

  // LOCAL mode task flow: same events as a real run, executed by the local
  // test API (the enclave's own executor) instead of the network.
  async runLocal(code) {
    const post = async (path, body) => {
      const res = await fetch(this.localEndpoint + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) throw new Error(`local API ${path} -> HTTP ${res.status}`);
      return res.json();
    };
    try {
      this.progress = ECEvent.INIT;
      let health;
      try {
        health = await post('/v1/health');
      } catch (e) {
        throw new Error(
          `Local test API not reachable at ${this.localEndpoint} — start it with 'ecld-test serve'. (${e.message})`
        );
      }
      this.dispatchECEvent(`LOCAL mode: backend functions ${JSON.stringify(health.backend)}`);
      this.progress = ECEvent.IN_PROGRESS;
      this.dispatchECEvent('Executing task on the local test API...');
      const resp = await post('/v1/task', { payload: code });
      this.result = this._applyEnvelope(resp.result);
      this.resultTaskCode = resp.task_code;
      this.resultTaskCodeName = resp.task_code_name;
      this.progress = ECEvent.FINISHED;
      if (resp.task_code === 0) {
        this.status = ECStatus.SUCCESS;
        this.dispatchECEvent('Task completed successfully (LOCAL mode).');
      } else {
        this.status = ECStatus.ERROR;
        this.dispatchECEvent(`Task failed (LOCAL mode): ${resp.task_code_name} — ${resp.result}`);
      }
      return resp.task_code === 0;
    } catch (error) {
      this.handleError(error);
    }
  }

  initializeContracts() {
    const wc = this.walletContext;
    const cfg = resolveNetworkConfig(this.networkAddress, this.chainId);
    if (!cfg) {
      throw new Error('Invalid network address');
    }
    this.networkConfig = cfg;
    if (cfg.family === 'bloxberg') {
      this.tokenContract = new EtnyContract(this.networkAddress, wc);
      this.protocolContract = new BloxbergProtocolContract(this.networkAddress, wc);
      this.protocolAbi = contractBloxberg.abi;
    } else {
      // ECLD family: Polygon mainnet/Amoy + IoTeX / Sepolia / LitVM testnets.
      this.tokenContract = new EcldContract(this.networkAddress, wc);
      this.protocolAbi = protocolContractPolygon.abi;
      // For the shared-token testnets the PoX address isn't known until a
      // chainId is read (resolveNetworkContext); build the protocol contract
      // now only when we already have the address.
      if (cfg.protocolAddress) {
        this.protocolContract = new PolygonProtocolContract(cfg.protocolAddress, wc);
      }
    }
  }

  /**
   * Finalise the network descriptor once a provider is available. The ECLD
   * testnets IoTeX / Sepolia / LitVM share a token address, so when no chainId
   * hint was passed to the constructor we read it from the provider and rebuild
   * the protocol contract against the correct PoX address. No-op for networks
   * that were already unambiguously resolved by token address.
   */
  async resolveNetworkContext() {
    const provisional = this.networkConfig && this.networkConfig.provisional;
    const provider = this.walletContext && this.walletContext.provider;
    if (!provider || !provider.getNetwork) {
      // Nothing to read the chainId from. If the config is already complete
      // (bloxberg / polygon / an explicit chainId), we're fine; otherwise the
      // shared-token testnet cannot be resolved.
      if (provisional) {
        throw new Error(
          'This network shares a token address with other ECLD testnets. Pass the chainId to the EthernityCloudRunner constructor, or supply a { provider } / { rpcUrl } so it can be detected.'
        );
      }
      return;
    }
    let chainId;
    try {
      const net = await provider.getNetwork();
      chainId = net && net.chainId;
    } catch (e) {
      if (provisional) throw e;
      return; // fall back to whatever initializeContracts() resolved
    }
    if (!chainId) {
      if (provisional) throw new Error('Unable to detect chainId to resolve the ECLD testnet.');
      return;
    }
    const cfg = resolveNetworkConfig(this.networkAddress, chainId);
    if (!cfg || cfg.provisional) {
      if (provisional) throw new Error(`Unsupported chainId ${chainId} for this token address.`);
      return;
    }
    this.chainId = chainId;
    // Build/rebuild the protocol contract when we just learned the PoX address
    // (shared-token testnet) or it changed from what the constructor resolved.
    if (cfg.family === 'ecld' &&
        (!this.protocolContract || cfg.protocolAddress !== this.networkConfig.protocolAddress)) {
      this.protocolContract = new PolygonProtocolContract(cfg.protocolAddress, this.walletContext);
    }
    this.networkConfig = cfg;
  }

  resetState() {
    this.nodeAddress = '';
    this.challengeHash = '';
    this.publicKey = '';
    this.orderId = -1;
    this.order = null;
    this.ordersOffset = -1;
    this.doHash = null;
    this.doRequest = -1;
    this.scriptHash = '';
    this.fileSetHash = '';
    this.taskHasBeenPickedForApproval = false;
    this.getResultFromOrderRepeats = 1;
    this.secureLockEnclave = null;
    this.trustedZoneImage = null;
    this.resources = null;
    this.enclaveImageIPFSHash = '';
    this.enclavePublicKey = '';
    this.enclaveDockerComposeIPFSHash = '';
    this.imageRegistryContract = null;
    this.status = ECStatus.DEFAULT;
    this.progress = ECEvent.INIT;
    this.lastError = null;
    this.log = [];
    this.result = null;
    this.logLevel = ECLog.INFO;
    this.running = false;
    this.network = "Bloxberg_Testnet";
  }

  logAppend(message, logLevel = ECLog.INFO) {
    const logLevelKey = Object.keys(ECLog).find((key) => ECLog[key] === logLevel);
    const logEntry = `[${logLevelKey}] ${formatDate()} ${message}`;
    if (this.logLevel >= logLevel) {
      this.log.push(logEntry);
    }
  }

  setLogLevel(logLevel) {
    this.logLevel = logLevel;
  }


  async checkWalletBalance(taskPrice) {
    this.dispatchECEvent('Checking wallet balance....');
    const balance = await this.tokenContract.getBalance();
    if (parseInt(balance, 10) < taskPrice) {
      throw new Error(`Insufficient wallet balance (${balance}/${taskPrice})`);
    }
  }

  async verifyNodeAddress(nodeAddress) {
    this.dispatchECEvent('Verifying node address...');
    if (!await this.isNodeOperatorAddress(nodeAddress)) {
      throw new Error('Invalid node operator address');
    }
    this.nodeAddress = nodeAddress;
  }

  async initializeImageRegistry(secureLockEnclave) {
    this.dispatchECEvent('Checking image registry...');
    this.secureLockEnclave = secureLockEnclave;
    // Resolve the Image Registry address from the network descriptor so the
    // ECLD-family networks (Amoy/IoTeX/Sepolia/LitVM) hit their own registry
    // rather than falling through the legacy 2-network switch. Bloxberg keeps
    // the same address for pynithy/nodenithy, so PYNITHY is a safe default.
    const registryAddress =
      (this.networkConfig && this.networkConfig.imageRegistry &&
        this.networkConfig.imageRegistry.PYNITHY) || undefined;
    this.imageRegistryContract = new ImageRegistryContract(
      this.networkAddress,
      'etny-pynithy-testnet',
      this.walletContext,
      registryAddress
    );
    await this.getEnclaveDetails();
  }

  async initializeWeb3Connection() {
    await this.tokenContract.initialize();
    if (!await this.handleWeb3Connection()) {
      throw new Error('Unable to connect to Web3');
    }
  }

  async checkAllowance(taskPrice) {
    // The ECLD family (Polygon + IoTeX / Sepolia / LitVM) pays via an ERC-20
    // token and must set an allowance for the protocol contract before ordering.
    // Bloxberg (ETNY) does not go through this path.
    if (this.networkConfig && this.networkConfig.family === 'ecld') {
      this.dispatchECEvent('Checking for the allowance on the current wallet...');
      if (!await this.tokenContract.checkAndSetAllowance(
        this.protocolContract.contractAddress(),
        '100',
        taskPrice.toString()
      )) {
        throw new Error('Unable to set allowance');
      }
      this.dispatchECEvent('Allowance checking completed.');
    }
  }

  async processTask(code) {
    // Failures caused by the submitted code are final results and are never
    // retried. Failures attributable to the node operator (order timeout,
    // unusable operator output, task code 40-49) are retried by submitting a
    // NEW DO request: the contract flips a DO request to BOOKED at first order
    // placement with no reset path, so the request itself cannot be reused;
    // the failed order's escrow is refunded by the validator.
    const maxRetries = Number.isInteger(this.maxTaskRetries) ? this.maxTaskRetries : 2;
    const retryDelayMs = Number.isInteger(this.taskRetryDelayMs) ? this.taskRetryDelayMs : 30000;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.processTaskAttempt(code);
      } catch (e) {
        if (!e.operatorFault || attempt >= maxRetries) throw e;
        this.dispatchECEvent(
          `Operator-side failure: ${e.message}. Resubmitting as a new request (retry ${attempt + 1}/${maxRetries})...`,
          ECLog.WARNING
        );
        await this.cleanup();
        await delay(retryDelayMs);
      }
    }
  }

  async processTaskAttempt(code) {
    this.challengeHash = generateRandomHexOfSize(20);
    const imageMetadata = await this.getV3ImageMetadata(this.challengeHash);
    const codeMetadata = await this.getV3CodeMetadata(code);
    const inputMetadata = await this.getV3InputMedata();
    await this.createDORequest(imageMetadata, codeMetadata, inputMetadata);
    await this.findOrder();
    if (!this.nodeAddress) {
      await this.approveOrder();
    }
    await this.waitforTaskToBeProcessed();
    await this.getOrderResult();
    return this.result != null;
  }

  handleError(error) {
    this.status = ECStatus.ERROR;
    this.dispatchECEvent(error.message);
    throw error;
  }

  // ... (other methods remain the same)

  isMainnet = () => !!(this.networkConfig && this.networkConfig.isMainnet);

  getLog = () => {
    return this.log;
  }

  getStatus = () => {
    return this.status;
  }


  dispatchECEvent = (message, log_level) => {
    this.logAppend(message, log_level);

    const status=this.status;
    const progress=this.progress;
    // Create a new custom event with a custom event name, and pass any data as the event detail
    const customEvent = new CustomEvent(status, { detail: { message, status, progress } });

    // Dispatch the custom event on the current instance of the class (or any DOM element)
    this.dispatchEvent(customEvent);
  };

  // The trustedzone whose cert we fetch is the pynithy variant of the resolved
  // network. Prefer an explicit setNetwork() value, then derive from the
  // network descriptor, then fall back to the legacy Bloxberg testnet name.
  resolveTrustedZoneImage() {
    if (this.trustedZoneImage) return this.trustedZoneImage;
    const key = this.networkConfig && this.networkConfig.networkKey;
    if (key && ECRunner[key]) {
      const suffix = this.networkConfig.isMainnet ? 'PYNITHY_RUNNER' : 'PYNITHY_RUNNER_TESTNET';
      if (ECRunner[key][suffix]) return ECRunner[key][suffix];
    }
    return 'etny-pynithy-testnet';
  }

  async getEnclaveDetails() {
    const details = await this.imageRegistryContract.getEnclaveDetailsV3(
      this.secureLockEnclave,
      VERSION,
      this.resolveTrustedZoneImage()
    );
    if (details) {
      [this.enclaveImageIPFSHash, this.enclavePublicKey, this.enclaveDockerComposeIPFSHash] = details;
      this.dispatchECEvent(`ENCLAVE_IMAGE_IPFS_HASH:${this.enclaveImageIPFSHash}`, ECLog.DEBUG);
      this.dispatchECEvent(`ENCLAVE_PUBLIC_KEY:${this.enclavePublicKey}`, ECLog.DEBUG);
      this.dispatchECEvent(`ENCLAVE_DOCKER_COMPOSE_IPFS_HASH:${this.enclaveDockerComposeIPFSHash}`, ECLog.DEBUG);
    }
  }

  getTokensFromFaucet = async () => {
    const account = this.tokenContract.getCurrentWallet();
    const balance = await this.tokenContract.getBalance(account);
    if (parseInt(balance, 10) <= 100) {
      const tx = await this.tokenContract.getFaucetTokens(account);
      const transactionHash = tx.hash;
      const isProcessed = await this.waitForTransactionToBeProcessed(this.tokenContract, transactionHash);
      if (!isProcessed) {
        return { success: false, message: 'Unable to create request, please check connectivity with Bloxberg node.' };
      }
      return { success: true };
    }
    return { success: true };
  };

  // eslint-disable-next-line class-methods-use-this
  async getReason(contract, txHash) {
    const tx = await contract.getProvider().getTransaction(txHash);
    if (!tx) {
      //console.log('tx not found');
      return 'Transaction hash not found';
    }
    delete tx.gasPrice;
    const code = await contract.getProvider().call(tx, tx.blockNumber);
    const reason = ethers.utils.toUtf8String(`0x${code.substring(138)}`);
    //console.log(reason);
    return reason.trim();
  }

  // eslint-disable-next-line class-methods-use-this
  async waitForTransactionToBeProcessed(tx, protocolEvent) {
    while (true) {
      try {
        this.dispatchECEvent(`TX:` + inspect(tx), ECLog.DEBUG);
        const txReceipt = await tx.wait();
        this.dispatchECEvent(`RECEIPT:` + inspect(txReceipt), ECLog.DEBUG);
  
        const events = txReceipt.events.find(event => event.event === protocolEvent);
        this.dispatchECEvent(`EVENTS:` + inspect(events), ECLog.DEBUG);
        txReceipt.result = events.args;

        return txReceipt;
      }
      catch (e) {
        if (e.message.includes('transaction failed')) {
          throw new Error(e.message);
        }
        this.dispatchECEvent('Transaction not confirmed yet: ' + e.message, ECLog.WARNING);
        await delay(1000);
      }
    }
  }


  async handleWeb3Connection() {
    try {
      // eth_requestAccounts is a MetaMask connection prompt and is only
      // meaningful for window.ethereum. With a raw key / injected signer the
      // account is already known, and a public JsonRpcProvider rejects
      // eth_requestAccounts, so skip it in that case.
      if (!this.walletContext || this.walletContext.usesWindowEthereum) {
        await this.tokenContract.getProvider().send('eth_requestAccounts', []);
      }
      const walletAddress = this.tokenContract.getCurrentWallet();
      return walletAddress !== null && walletAddress !== undefined;
    } catch (e) {
      return false;
    }
  }

  async approveOrder() {
    while (true) {
      try {
        this.dispatchECEvent(`Approving task ${this.orderId}`);

        const tx = await this.protocolContract.approveOrder(this.orderId);
        this.dispatchECEvent(`${tx.hash} is pending...`)
        await this.waitForTransactionToBeProcessed(tx, '_orderApprovedEV');
        this.dispatchECEvent(`Task ${this.orderId} approved successfully!`);
        break;
      }
      catch (e) {
        this.dispatchECEvent(`Failed to approve task ${this.orderId}: ${e.message}`,ECLog.WARNING);
        await delay(1000);
      }
    }
    while (true) {
      try {
        const order = await this.protocolContract.getOrder(this.orderId);
        this.nodeAddress = order.dproc;
        break;
      }
      catch (e) {
        this.dispatchECEvent(`Failed to get nodeAddress for task ${this.orderId}: ${e.message}`,ECLog.WARNING);
        await delay(1000);
      }
    }
    return true;
  }

  waitforTaskToBeProcessed = async () => {
    this.progress = ECEvent.IN_PROGRESS
    this.dispatchECEvent(`Operator ${this.nodeAddress} is processing task ${this.orderId}`);
    // An honest node holds an order at most its duration plus the node agent's
    // own result wait (~62 min); past that the operator is hung or offline and
    // the order will never leave PROCESSING on its own.
    const durationHours = (this.resources && this.resources.duration) || 1;
    const deadline = Date.now() + (durationHours * 3600 + 900) * 1000;
    const protocolContract = this.protocolContract.getContract();
    const orderId = parseInt(this.orderId);

    // EVENT-FIRST: _orderClosedEV(_orderNumber) fires the moment the operator
    // records the result. Like _orderPlacedEV it has no indexed params, so we
    // match the order number in the handler.
    let closedHandler = null;
    const viaEvent = new Promise((resolve) => {
      closedHandler = (orderNumber) => {
        if (parseInt(orderNumber) === orderId) {
          this.dispatchECEvent(`_orderClosedEV: order ${orderId} closed`, ECLog.DEBUG);
          resolve(true);
        }
      };
      try {
        protocolContract.on('_orderClosedEV', closedHandler);
      } catch (e) {
        this.dispatchECEvent(`Event subscription unavailable (${e.message}); relying on polling`, ECLog.DEBUG);
        closedHandler = null;
      }
    });

    // POLL FALLBACK at a relaxed cadence: covers cancelled/other terminal
    // states that don't emit _orderClosedEV, unreliable RPC filters, and the
    // deadline for hung operators.
    let stopPolling = false;
    const viaPoll = (async () => {
      while (!stopPolling) {
        if (Date.now() > deadline) {
          const err = new Error(`Order ${this.orderId} was not completed within its duration (operator hung or offline)`);
          err.operatorFault = true;
          throw err;
        }
        try {
          const order = await this.protocolContract.getOrder(this.orderId);
          this.dispatchECEvent(`Order:` + inspect(order), ECLog.DEBUG);
          if (parseInt(order.status) == 1) {
            this.dispatchECEvent(`Task ${this.orderId} (request ${this.doRequest}) is still processing...`, ECLog.DEBUG);
            await delay(15000);
          } else {
            this.dispatchECEvent(`Task ${this.orderId} status is ${order.status}, continuing`, ECLog.DEBUG);
            return true;
          }
        }
        catch (e) {
          if (e.operatorFault) throw e;
          this.dispatchECEvent(`Error while waiting for task to be processed: ${e.message}`, ECLog.WARNING);
          await delay(2000);
        }
      }
      return true;
    })();

    try {
      return await Promise.race([viaEvent, viaPoll]);
    } finally {
      stopPolling = true;
      // If the event won, the poll task keeps one in-flight iteration; swallow
      // a late deadline rejection so it can't surface as unhandled.
      viaPoll.catch(() => {});
      if (closedHandler) {
        try { protocolContract.off('_orderClosedEV', closedHandler); } catch (e) { /* already gone */ }
      }
    }
  }

  getOrderResult = async () => {
    this.dispatchECEvent(`Task ${this.orderId} was successfully processed.`);
    const parsedOrderResult = await this.getResultFromOrder();
    if (parsedOrderResult.success === false) {
      const err = new Error(parsedOrderResult.message);
      if (parsedOrderResult.operatorFault) {
        // Leave status untouched: processTask() may retry; run()'s error
        // handler sets ERROR if all attempts are exhausted.
        err.operatorFault = true;
      } else {
        this.status = ECStatus.ERROR;
        this.progress = ECEvent.FINISHED;
      }
      this.dispatchECEvent(parsedOrderResult.message);
      throw err;
    } else {
      this.result = this._applyEnvelope(parsedOrderResult.result);
      this.status = ECStatus.SUCCESS;
      this.progress = ECEvent.FINISHED;
      this.dispatchECEvent(`Task completed successfully.`);
    }
  }

  async getWalletPublicKey() {
    // Prefer an explicitly provided / derived X25519 encryption key (Web3Auth,
    // raw key, or app-supplied) so we never need the MetaMask-only
    // eth_getEncryptionPublicKey method.
    if (this.walletContext && this.walletContext.encryptionPublicKey) {
      return this.walletContext.encryptionPublicKey;
    }
    // eth_getEncryptionPublicKey only exists on window.ethereum (MetaMask). If we
    // were initialised with a signer/provider (but no raw privateKey to derive
    // from and no explicit encryptionPublicKey), we cannot obtain it. Fail with
    // an actionable message instead of a cryptic "window.ethereum is undefined".
    if (this.walletContext && !this.walletContext.usesWindowEthereum) {
      throw new Error(
        'Cannot obtain the wallet encryption public key: this wallet has no ' +
          'eth_getEncryptionPublicKey. Pass { privateKey } (to derive it) or ' +
          '{ encryptionPublicKey } to EthernityCloudRunner.'
      );
    }
    await this.tokenContract.initialize();
    const account = this.tokenContract.getCurrentWallet();
    // Fall back to MetaMask only when running through window.ethereum.
    const keyB64 = await window.ethereum.request({
      method: 'eth_getEncryptionPublicKey',
      params: [account]
    });
    return Buffer.from(keyB64, 'base64').toString('hex');
  }
  async setPublicKey(publicKey){
    this.publicKey = publicKey;
  }

  async getV3ImageMetadata(challengeHash) {
    // generating encrypted base64 hash of the challenge
    const base64EncryptedChallenge = await encryptWithCertificate(challengeHash, this.enclavePublicKey);

    // uploading to IPFS the base64 encrypted challenge
    const challengeIPFSHash = await ipfsClient.uploadToIPFS(base64EncryptedChallenge);

    // The challenge hash is a REQUIRED field of the DO-request metadata. If the
    // IPFS upload failed we must NOT build a request with a null/empty hash: it
    // serializes on-chain as the literal "null", the node cannot fetch it, the
    // (already paid) order gets cancelled, and the task never completes. Abort
    // here instead so no gas is spent on a doomed request.
    if (!challengeIPFSHash || challengeIPFSHash === 'null') {
      throw new Error(
        'Failed to upload the challenge to IPFS (got no hash). Aborting before submitting the request. ' +
        'Check IPFS connectivity.'
      );
    }

    this.dispatchECEvent(`Uploaded challenge to IPFS: ${challengeIPFSHash}`);

    const publicKey = this.publicKey ? this.publicKey : await this.getWalletPublicKey();
    // image metadata for v3 format v3:image_ipfs_hash:image_name:docker_compose_ipfs_hash:client_challenge_ipfs_hash:public_key
    return `${VERSION}:${this.enclaveImageIPFSHash}:etny-pynithy-testnet:${
      this.enclaveDockerComposeIPFSHash
    }:${challengeIPFSHash}:${publicKey}`;
  }

  async getV3CodeMetadata(code) {
    // extracting code from all the code cells
    let scriptChecksum = sha256(code);
    // uploading all node js code to IPFS and received hash of transaction
    const base64EncryptedScript = await encryptWithCertificate(code, this.enclavePublicKey);
    this.scriptHash = await ipfsClient.uploadToIPFS(base64EncryptedScript);

    // The payload (code) hash is REQUIRED -- it is the program the enclave
    // executes. As with the challenge, refuse to build/submit a request if the
    // upload produced no hash (see getV3ImageMetadata for the full rationale).
    if (!this.scriptHash || this.scriptHash === 'null') {
      throw new Error(
        'Failed to upload the task code to IPFS (got no hash). Aborting before submitting the request. ' +
        'Check IPFS connectivity.'
      );
    }

    this.dispatchECEvent(`Uploaded encrypted code to IPFS: ${this.scriptHash}`);

    // scriptChecksum = await this.tokenContract.signMessage(scriptChecksum);
    // v3:code_ipfs_hash:code_checksum
    return `${VERSION}:${this.scriptHash}:${scriptChecksum}`;
  }

  async getV3InputMedata() {
    // No-input tasks declare the empty-fileset checksum. ZERO_CHECKSUM is ALREADY
    // sha256("") -- the value the enclave computes for an empty/absent input. It
    // must NOT be hashed again: sha256(ZERO_CHECKSUM) yields a different value
    // (cd372fb8...) that the enclave never produces, so trustedzone rejects every
    // no-input task with "INPUT CHECKSUM DOESN'T MATCH". Declare ZERO_CHECKSUM
    // as-is so it matches the enclave's sha256(empty).
    let fileSetChecksum = ZERO_CHECKSUM;
    // v3::filesetchecksum
    return `${VERSION}::${fileSetChecksum}`;
  }


  createDORequest = async (imageMetadata, codeMetadata, inputMetadata) => {
    try {
      // Belt-and-suspenders: never submit a (paid) request whose metadata carries
      // a null/empty required IPFS hash. imageMetadata is
      //   v3:image:name:compose:challenge:pubkey   (challenge required, index 4)
      // codeMetadata is
      //   v3:code:checksum                          (code required, index 1)
      // inputMetadata is v3::checksum -- the input hash is legitimately optional.
      // A "null"/empty in a required slot means an upstream upload failed; abort
      // now so the node never gets a request it cannot fulfill.
      const _imgParts = String(imageMetadata).split(':');
      const _codeParts = String(codeMetadata).split(':');
      const _bad = (h) => !h || h === 'null';
      if (_bad(_imgParts[4])) {
        throw new Error(`Refusing to submit DO request: challenge IPFS hash is "${_imgParts[4]}" (upload failed).`);
      }
      if (_bad(_codeParts[1])) {
        throw new Error(`Refusing to submit DO request: code IPFS hash is "${_codeParts[1]}" (upload failed).`);
      }

      this.ordersOffset = await this.protocolContract.getContract()._getOrdersCount();

      this.progress = ECEvent.SENDING;

      this.dispatchECEvent(`Submitting transaction for DO request`);
      // add here call to SC(smart contract)
      const tx = await this.protocolContract.addDORequest(
        imageMetadata,
        codeMetadata,
        inputMetadata,
        this.nodeAddress,
        this.resources,
      );

      this.doHash = tx.hash;

      this.dispatchECEvent(`${this.doHash} is pending...`);

      const isProcessed = await this.waitForTransactionToBeProcessed(tx, '_addDORequestEV');
      this.dispatchECEvent(`${this.doHash} confirmed!`);

      const [ txFrom, requestId ] = isProcessed.result;
      this.doRequest = requestId;

      this.dispatchECEvent(`Request ${this.doRequest} was created successfully.`);

      return true;
    } catch (e) {
      this.status = ECStatus.ERROR;
      this.dispatchECEvent(`Transaction failed: ${e.message}`);
      throw new Error(`Transaction failed: ${e.message}`);
    }
  }

  findOrder = async () => {
    this.progress = ECEvent.CREATED;
    this.dispatchECEvent(`Waiting for Ethernity CLOUD network... `);
    const protocolContract = this.protocolContract.getContract();
    const doReq = parseInt(this.doRequest);

    // EVENT-FIRST: bind to _orderPlacedEV(_orderNumber, _doRequestId,
    // _dpRequestId) and resolve the moment OUR request's order is placed --
    // push-based and near-instant. The event has no indexed params, so we
    // subscribe to all placements and match the request id in the handler.
    let eventHandler = null;
    let resolveFound;
    const viaEvent = new Promise((resolve) => { resolveFound = resolve; });
    eventHandler = (orderNumber, doRequestId, _dpRequestId) => {
      if (parseInt(doRequestId) === doReq) {
        this.dispatchECEvent(`_orderPlacedEV: order ${orderNumber} for request ${doReq}`, ECLog.DEBUG);
        resolveFound(parseInt(orderNumber));
      }
    };
    try {
      protocolContract.on('_orderPlacedEV', eventHandler);
    } catch (e) {
      this.dispatchECEvent(`Event subscription unavailable (${e.message}); relying on polling`, ECLog.DEBUG);
      eventHandler = null;
    }

    // CATCH-UP: one log query over the recent past covers the race where the
    // placement fired before the listener attached -- no struct scanning.
    (async () => {
      try {
        const current = await protocolContract.provider.getBlockNumber();
        const filter = protocolContract.filters._orderPlacedEV();
        const logs = await protocolContract.queryFilter(filter, Math.max(0, current - 300), current);
        for (const lg of logs) {
          if (parseInt(lg.args._doRequestId) === doReq) {
            this.dispatchECEvent(`_orderPlacedEV (catch-up): order ${lg.args._orderNumber} for request ${doReq}`, ECLog.DEBUG);
            resolveFound(parseInt(lg.args._orderNumber));
            return;
          }
        }
      } catch (e) {
        this.dispatchECEvent(`Catch-up log query failed: ${e.message}`, ECLog.DEBUG);
      }
    })();

    // POLL FALLBACK, grace-delayed: the struct scan only starts if the event
    // path has stayed silent past the grace window (or never attached), so a
    // healthy RPC resolves purely on logs and the scan never runs.
    const POLL_GRACE_MS = 30000;
    let stopPolling = false;
    const viaPoll = (async () => {
      const graceEnd = eventHandler ? Date.now() + POLL_GRACE_MS : 0;
      while (!stopPolling && Date.now() < graceEnd) {
        await delay(500);
      }
      while (!stopPolling) {
        try {
          const ordersCount = await protocolContract._getOrdersCount();
          this.dispatchECEvent(`Orders count: ${ordersCount}`, ECLog.DEBUG);
          for (let i = ordersCount - 1; i >= this.ordersOffset; i--) {
            if (stopPolling) return -1;
            const order = await protocolContract._getOrder(i);
            if (parseInt(order.doRequest) === doReq) {
              this.dispatchECEvent(`Found order ${i} for request ${doReq} (poll)`, ECLog.DEBUG);
              return i;
            }
          }
          await delay(2000);
        } catch (e) {
          this.dispatchECEvent(`Failed to find order: ` + e.message, ECLog.WARNING);
          await delay(2000);
        }
      }
      return -1;
    })();

    try {
      const orderId = await Promise.race([viaEvent, viaPoll]);
      this.orderId = orderId;
      this.order = await protocolContract._getOrder(orderId);
      this.progress = ECEvent.ORDER_PLACED;
      this.dispatchECEvent(`Connected! (order ${orderId}, request ${doReq})`);
      return true;
    } finally {
      stopPolling = true;
      if (eventHandler) {
        try { protocolContract.off('_orderPlacedEV', eventHandler); } catch (e) { /* already gone */ }
      }
    }
  }

  // eslint-disable-next-line class-methods-use-this
  parseOrderResult = (result) => {
    try {
      const arr = result.split(':');
      const tBytes = arr[1].startsWith('0x') ? arr[1] : `0x${arr[1]}`;
      return {
        version: arr[0],
        transactionBytes: tBytes,
        resultIPFSHash: arr[2]
      };
    } catch (e) {
      throw new Error(ECError.PARSE_ERROR);
    }
  };

  parseTransactionBytes(bytes) {
    try {
      const result = parseTransactionBytes(this.protocolAbi, bytes);
      const arr = result.result.split(':');
      return {
        version: arr[0],
        from: result.from,
        taskCode: arr[1],
        taskCodeString: taskStatusName(arr[1]),
        checksum: arr[2],
        enclaveChallenge: arr[3]
      };
    } catch (e) {
      throw new Error(ECError.PARSE_ERROR);
    }
  }

  async getResultFromOrder() {
    try {
      // get the result of the order using the `etnyContract` object
      this.progress = ECEvent.DOWNLOADING;
      this.dispatchECEvent(`Downloading result...`);
      const orderResult = await this.protocolContract.getResultFromOrder(this.orderId);

      // parse the order result
      const parsedOrderResult = this.parseOrderResult(orderResult);
      if(parsedOrderResult.resultIPFSHash === undefined) {
        return { success: false, operatorFault: true, message: 'Task processing failed, no IPFS hash returned' };
      }

      this.dispatchECEvent(`Downloading: ${parsedOrderResult.resultIPFSHash}`);
      this.progress = ECEvent.VERIFYING;
      // parse the transaction bytes of the order result
      const transactionResult = this.parseTransactionBytes(parsedOrderResult.transactionBytes);

      // Task codes 40-49 mean the enclave stack on the node never ran the task
      // (not started, unusable output, storage down). The escrow is refunded by
      // the validator, so this is safe to retry with a fresh DO request.
      if (isOperatorFaultCode(transactionResult.taskCode)) {
        return {
          success: false,
          operatorFault: true,
          message: `Task failed on the operator side: ${transactionResult.taskCodeString} (${transactionResult.taskCode})`
        };
      }

      // generate a wallet address using the `challengeHash` and `transactionResult.enclaveChallenge`
      const wallet = generateWallet(this.challengeHash, transactionResult.enclaveChallenge);
      // check if the generated wallet address matches the `transactionResult.from` address
      if (!wallet || wallet !== transactionResult.from) {
        return { success: false, operatorFault: true, message: 'Integrity check failed, signer wallet address is wrong.' };
      }

      // get the result value from IPFS using the `parsedOrderResult.resultIPFSHash`
      const ipfsResult = await ipfsClient.getFromIPFS(parsedOrderResult.resultIPFSHash);
      // decrypt data
      this.dispatchECEvent(`Validating proof...`);
      const currentWalletAddress = this.tokenContract.getCurrentWallet();
      const decryptedData = await decryptWithPrivateKey(
        ipfsResult,
        currentWalletAddress,
        this.walletContext ? this.walletContext.privateKey : null
      );

      if (!decryptedData.success) {
        // Not an operator fault: the common cause is a wrong client key, and
        // auto-resubmitting would spend gas without changing the outcome.
        return { success: false, message: 'Could not decrypt the order result.' };
      }

      // update the loading message to show the result value
      //this.dispatchECEvent(`Result value: ${decryptedData.data}`);
      // calculate the SHA-256 checksum of the result value
      const ipfsResultChecksum = sha256(decryptedData.data);
      // check if the calculated checksum matches the `transactionResult.checksum`
      if (ipfsResultChecksum !== transactionResult.checksum) {
        return { success: false, operatorFault: true, message: 'Integrity check failed, checksum of the order result is wrong.' };
      }

      
      return {
        success: true,
        contractAddress: this.tokenContract.contractAddress(),
        inputTransactionHash: this.doHash,
        orderId: this.orderId,
        imageHash: `${this.enclaveImageIPFSHash}:${this.secureLockEnclave}`,
        scriptHash: this.scriptHash,
        fileSetHash: this.fileSetHash,
        resultHash: parsedOrderResult.resultIPFSHash,
        resultTaskCode: transactionResult.taskCodeString,
        resultValue: ipfsResult,
        result: decryptedData.data
      };
    } catch (ex) {
      //console.log(ex);
      if (ex.name === ECError.PARSE_ERROR) {
        return { success: false, operatorFault: true, message: 'Ethernity parsing transaction error.' };
      }
      if (ex.name === ECError.IPFS_DOWNLOAD_ERROR) {
        return { success: false, operatorFault: true, message: 'Ethernity IPFS download result error.' };
      }
      await delay(5000);
      this.getResultFromOrderRepeats += 1;
      // eslint-disable-next-line no-return-await
      return await this.getResultFromOrder();
    }
  }

  async getProofDetails(endBlockNumber = this.protocolContract.getProvider().getBlockNumber()) {
      // get the original input transaction hash and the output transaction hash for the order
      const transaction = await this.protocolContract.getProvider().getTransaction(this.doHash);
      const startBlockNumber = await this.protocolContract.getProvider().getBlock(transaction.blockNumber);
      const startblockTimestamp = startBlockNumber.timestamp;

      let resultBlockNumber;
      let resultTransactionHash;
      let resultBlockTimestamp;

      // eslint-disable-next-line no-plusplus
      for (let i = endBlockNumber; i >= startBlockNumber; i--) {
      /// eslint-disable-next-line no-await-in-loop
        const block = await this.protocolContract.getProvider().getBlockWithTransactions(i);
        // eslint-disable-next-line no-continue
        if (!block || !block.transactions) continue;

        // eslint-disable-next-line no-restricted-syntax
        for (const transaction of block.transactions) {
          if (transaction.to === this.protocolContract.contractAddress() && transaction.data) {
            resultBlockNumber = transaction.blockNumber;
            resultTransactionHash = transaction.hash;
            resultBlockTimestamp = block.timestamp;
          }
        }
      }

      return {
        inputTransactionHash: this.doHash,
        inputTimestamp: startblockTimestamp,
        inputBlockNumber: startblockNumber,
        outputTransactionHash: outputTransactionHash,
        outputBlockTimestamp: resultBlockTimestamp,
        outputBlockNumber: resultBlockNumber,
      }
  }
  async getResult() {
    return this.result;
  }

  /** Typed view of the last result: { type, data, esr, raw } (or null). */
  getStructuredResult() {
    return this.structuredResult || null;
  }

  /**
   * Decode the structured result envelope (legacy strings pass through).
   * Returns the legacy STRING view for this.result so string-treating dApps
   * keep working; the typed view is kept on this.structuredResult. When the
   * state cache is enabled, every envelope's esr entries refresh it.
   */
  _applyEnvelope(raw) {
    const parsed = parseResultEnvelope(raw);
    this.structuredResult = {
      type: parsed.type,
      data: parsed.data,
      esr: parsed.esr,
      raw: parsed.raw,
    };
    const esr = parsed.esr;
    if (esr && esr.wallet) {
      if (this.secureLockEnclave) {
        this._esrWalletMemo = this._esrWalletMemo || {};
        this._esrWalletMemo[this.secureLockEnclave] = esr.wallet;
      }
      const cache = this._getStateCache();
      if (cache) {
        for (const entry of esr.entries || []) {
          try {
            if ('state' in entry) {
              cache.set(esr.wallet, entry.key, entry.state, entry.version || 0, entry.cid);
            }
          } catch (e) { /* cache is best-effort */ }
        }
      }
    }
    return parsed.legacy;
  }

  /**
   * The active state cache, creating the default one on first use. The cache
   * is ON BY DEFAULT (localStorage in the browser, in-memory Map under Node);
   * returns null only after disableStateCache().
   */
  _getStateCache() {
    if (this._stateCacheDisabled) return null;
    if (!this.stateCache) this.stateCache = new StateCache();
    return this.stateCache;
  }

  /**
   * Configure the ESR state cache (it is already ON BY DEFAULT). Use this only
   * to choose a backend: `backend` is any { get, set, delete, keys } store;
   * defaults to localStorage in the browser and an in-memory Map under Node.
   * Every task result carrying an ESR attachment refreshes the cache, and
   * esrRead() serves unchanged state from it after a free on-chain check.
   */
  enableStateCache(backend = null) {
    this._stateCacheDisabled = false;
    this.stateCache = new StateCache(backend);
    return this.stateCache;
  }

  /** Turn the ESR state cache OFF — esrRead then always runs a task. */
  disableStateCache() {
    this._stateCacheDisabled = true;
    this.stateCache = null;
  }

  /**
   * Cache-gated ESR read.
   *
   * Serves state from the cache while a FREE on-chain check (getState
   * eth_call via `registryAddress`) confirms it is current; otherwise submits
   * one state-fetch task (the SDK's built-in `esrFetch`, or `readCode`) and
   * refreshes the cache from its result envelope.
   *
   * Returns { state, version, cid, wallet, fromCache, checkedOnChain }.
   */
  async esrRead({
    key,
    registryAddress = null,
    enclaveWallet = null,
    readCode = null,
    force = false,
    trustMinVersion = null,
    walletContext = null,
  } = {}) {
    if (!key) throw new Error('esrRead requires a key');
    this._esrWalletMemo = this._esrWalletMemo || {};
    let wallet = enclaveWallet || this._esrWalletMemo[this.secureLockEnclave || ''];

    let checkedOnChain = false;
    const cache = this._getStateCache();
    if (!force && cache && wallet && registryAddress) {
      const entry = cache.get(wallet, key);
      if (entry) {
        try {
          const esr = new ESRContract(registryAddress, walletContext);
          const onchain = await esr.getState(wallet, key);
          checkedOnChain = true;
          // Prefer cid equality (content-addressed); fall back to version.
          // trustMinVersion covers the caller's own still-relaying commit:
          // external writes only increase the version, so they invalidate.
          let fresh = false;
          if (entry.cid && onchain.cid) fresh = entry.cid === onchain.cid;
          if (!fresh) fresh = Number(onchain.version) === Number(entry.version);
          if (!fresh && trustMinVersion != null) {
            fresh = Number(onchain.version) <= Number(trustMinVersion);
          }
          if (fresh) {
            return {
              state: entry.state,
              version: entry.version,
              cid: entry.cid,
              wallet,
              fromCache: true,
              checkedOnChain: true,
            };
          }
        } catch (e) {
          // Fail safe: never serve a maybe-stale cache on an errored check.
          checkedOnChain = false;
        }
      }
    }

    // Miss / stale / forced: run one state-fetch task, cache from its envelope.
    const code = readCode || `esrFetch('${key}')`;
    await this.processTask(code);
    const structured = this.getStructuredResult();
    const esrAtt = (structured && structured.esr) || null;
    if (!esrAtt) {
      throw new Error(
        `esrRead: result carried no state for key '${key}' ` +
          '(is the enclave built with ESR and the new result API?)'
      );
    }
    wallet = esrAtt.wallet || wallet;
    const entry = (esrAtt.entries || []).find((e) => e.key === key);
    if (!entry) {
      throw new Error(`esrRead: result carried no state entry for key '${key}'`);
    }
    return {
      state: entry.state,
      version: entry.version,
      cid: entry.cid,
      wallet,
      fromCache: false,
      checkedOnChain,
    };
  }

  /**
   * Current on-chain { wallet, version, cid } for an ESR key — free (a single
   * eth_call), no task, no gas. version 0 means never committed.
   *
   * `enclaveAddress` is the enclave's own address (the namespace its state
   * lives under); when omitted, the wallet learned from previous result
   * envelopes for this enclave is used.
   */
  async esrVersion({
    key,
    registryAddress,
    enclaveAddress = null,
    enclaveWallet = null,
    walletContext = null,
  } = {}) {
    if (!key) throw new Error('esrVersion requires a key');
    if (!registryAddress) throw new Error('esrVersion requires registryAddress');
    this._esrWalletMemo = this._esrWalletMemo || {};
    const wallet =
      enclaveAddress || enclaveWallet || this._esrWalletMemo[this.secureLockEnclave || ''];
    if (!wallet) {
      throw new Error(
        'esrVersion requires enclaveAddress (no previous run to learn it from)'
      );
    }
    const esr = new ESRContract(registryAddress, walletContext || this.walletContext);
    const onchain = await esr.getState(wallet, key);
    return { wallet, version: Number(onchain.version || 0), cid: onchain.cid || null };
  }

  /**
   * Last accepted idempotency nonce for an ESR key — { wallet, nonce }, free
   * (a single eth_call), no task, no gas. nonce 0 means no guarded commit was
   * ever made.
   *
   * The nonce is PUBLIC on-chain data: the registry records it next to the
   * version, so a web3 app reads the latest accepted value here and submits
   * the state-writing task with EXACTLY nonce + 1 -- the contract enforces
   * the sequence strictly (1, 2, 3, ... per key; no gaps, no reuse). A
   * duplicate or out-of-sequence submission fails with task code 36
   * (ESR_NONCE_VIOLATION) instead of applying twice.
   */
  async esrNonce({
    key,
    registryAddress,
    enclaveAddress = null,
    enclaveWallet = null,
    walletContext = null,
  } = {}) {
    if (!key) throw new Error('esrNonce requires a key');
    if (!registryAddress) throw new Error('esrNonce requires registryAddress');
    this._esrWalletMemo = this._esrWalletMemo || {};
    const wallet =
      enclaveAddress || enclaveWallet || this._esrWalletMemo[this.secureLockEnclave || ''];
    if (!wallet) {
      throw new Error(
        'esrNonce requires enclaveAddress (no previous run to learn it from)'
      );
    }
    const esr = new ESRContract(registryAddress, walletContext || this.walletContext);
    return { wallet, nonce: await esr.getNonce(wallet, key) };
  }

  /**
   * Wait (free polling eth_calls) until the key's on-chain version is GREATER
   * than `sinceVersion`; resolves with the fresh { wallet, version, cid }.
   *
   * The intended pattern — read the version, submit the state-writing task,
   * then wait for the commit to actually land on-chain:
   *
   *   const { version } = await runner.esrVersion({ key, registryAddress, enclaveAddress });
   *   await runner.run(...);                      // task that commits state
   *   await runner.esrWaitForVersion({ key, sinceVersion: version, registryAddress, enclaveAddress });
   */
  async esrWaitForVersion({
    key,
    sinceVersion,
    registryAddress,
    enclaveAddress = null,
    enclaveWallet = null,
    walletContext = null,
    timeoutMs = 120000,
    pollMs = 3000,
  } = {}) {
    if (!key) throw new Error('esrWaitForVersion requires a key');
    if (sinceVersion == null) throw new Error('esrWaitForVersion requires sinceVersion');
    if (!registryAddress) throw new Error('esrWaitForVersion requires registryAddress');
    this._esrWalletMemo = this._esrWalletMemo || {};
    const wallet =
      enclaveAddress || enclaveWallet || this._esrWalletMemo[this.secureLockEnclave || ''];
    if (!wallet) {
      throw new Error(
        'esrWaitForVersion requires enclaveAddress (no previous run to learn it from)'
      );
    }
    const esr = new ESRContract(registryAddress, walletContext || this.walletContext);
    const advanced = await esr.waitForVersion(wallet, key, Number(sinceVersion), timeoutMs, pollMs);
    if (advanced == null) {
      throw new Error(
        `ESR state for '${key}' did not advance past version ${sinceVersion} ` +
          `within ${timeoutMs}ms`
      );
    }
    const onchain = await esr.getState(wallet, key);
    return { wallet, version: Number(onchain.version || 0), cid: onchain.cid || null };
  }

  reset = () => {
    this.orderId = -1;
    this.doHash = null;
    this.doRequest = -1;
    this.scriptHash = '';
    this.fileSetHash = '';
    this.interval = null;
    this.getResultFromOrderRepeats = 1;
    this.taskHasBeenPickedForApproval = false;
  };

  cleanup = async () => {
    this.reset();
    const contract = this.protocolContract.getContract();
    contract.removeAllListeners();
  };

  isNodeOperatorAddress = async (nodeAddress) => {
    if (isNullOrEmpty(nodeAddress)) return true;
    if (isAddress(nodeAddress)) {
      const isNode = await this.protocolContract.isNodeOperator(nodeAddress);
      if (!isNode) {
        this.status = ECStatus.ERROR;
        this.dispatchECEvent('Introduced address is not a valid node operator address.');
        throw new Error('Introduced address is not a valid node operator address.');
      }
      return true;
    }
    this.status = ECStatus.ERROR;
    this.dispatchECEvent('Introduced address is not a valid wallet address.');
    throw new Error('Introduced address is not a valid wallet address.');
  };

  // eslint-disable-next-line class-methods-use-this
  initializeStorage(ipfsAddress, protocol, port, token) {
    ipfsClient.initialize(ipfsAddress, protocol, port, token);
  }

  // use this in order to reset the instance and have a new runner
  static resetInstance() {
    EthernityCloudRunner.instance = null;
  }


  async setNetwork(network, type) {
      this.network = network.toLowerCase()+ "_" + type.toUpperCase()
      this.trustedZoneImage = ECRunner[network.toUpperCase()]["PYNITHY_RUNNER_"+type.toUpperCase()]
  }

  async checkNetwork() {
    try {
      // checking network
      const networkName = await this.tokenContract.getNetworkName();
      const expected = this.networkConfig && this.networkConfig.networkName;
      if (expected && networkName !== expected) {
        this.status = ECStatus.ERROR;
        const label = (this.networkConfig.networkKey || expected).toString();
        this.dispatchECEvent(`Please switch Web3 network and use ${label}!`);
        throw new Error(`Please switch Web3 network and use ${label}!`);
      }
      return networkName === expected;
    } catch (e) {
      this.status = ECStatus.ERROR;
      this.dispatchECEvent(
        `Error while connecting web3 client: ${e.message}`,
      );
      throw new Error(
        `Error while connecting web3 client: ${e.message}`,
      );
      return false;
    }
  }

  async run(resources, secureLockEnclave, code, nodeAddress = '', trustedZoneEnclave = 'etny-nodenithy-testnet', options = {}) {
    if (this.localMode) {
      this.resources = resources;
      return this.runLocal(code);
    }
    // SERIALIZE concurrent run() calls on this instance. Task state
    // (doRequest, orderId, order, result, ...) lives on the instance, so two
    // interleaved runs would track the SAME order, fail each other's
    // integrity checks against the wrong result, and collide on the wallet's
    // transaction nonce (TRANSACTION_REPLACED). Each extra call queues and
    // gets its own order, in submission order. For truly parallel tasks use
    // one runner instance per task (or per wallet).
    const previous = this._runQueue || Promise.resolve();
    let release;
    this._runQueue = new Promise((r) => { release = r; });
    const queued = previous !== null && this._runInFlight;
    if (queued) {
      this.dispatchECEvent('Another task is in flight on this runner -- queued; it will get its own order when the current one finishes.');
    }
    await previous.catch(() => {});
    this._runInFlight = true;
    try {
      return await this._runExclusive(resources, secureLockEnclave, code, nodeAddress, trustedZoneEnclave, options);
    } finally {
      this._runInFlight = false;
      release();
    }
  }

  async _runExclusive(resources, secureLockEnclave, code, nodeAddress, trustedZoneEnclave, options) {
    try {
      this.resources = resources;
      // Operator-side failures are resubmitted as a new DO request up to
      // maxRetries times; failures caused by the submitted code never retry.
      this.maxTaskRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
      this.taskRetryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 30000;
      // If the app never configured storage, fall back to the default IPFS
      // endpoint so the challenge/code upload doesn't fail with a null client.
      // An explicit initializeStorage() call before run() takes precedence.
      if (!ipfsClient.isInitialized()) {
        this.initializeStorage(DEFAULT_IPFS_ADDRESS);
      }
      // Disambiguate shared-token ECLD testnets (IoTeX/Sepolia/LitVM) from the
      // live provider before any contract call depends on the PoX address.
      await this.resolveNetworkContext();
      await this.checkWalletBalance(this.resources.taskPrice);
      await this.verifyNodeAddress(nodeAddress);
      await this.initializeImageRegistry(secureLockEnclave);
      await this.initializeWeb3Connection();
      await this.checkAllowance(this.resources.taskPrice);
      await this.processTask(code);
    } catch (error) {
      this.handleError(error);
    }
  }

}

export default EthernityCloudRunner;
