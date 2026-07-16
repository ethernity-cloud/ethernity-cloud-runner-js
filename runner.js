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
  resolveNetworkConfig
} from './enums.js';
import PolygonProtocolContract from './contract/operation/polygonProtocolContract.js';
import BloxbergProtocolContract from './contract/operation/bloxbergProtocolContract.js';
import { Buffer } from 'buffer';
import util from 'util';

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
    // Optional disambiguator for the ECLD-family testnets (IoTeX / Sepolia /
    // LitVM) that share a token address. When omitted, it is resolved from the
    // wallet provider's chainId in resolveNetworkContext() before the run.
    this.chainId = chainId;
    // ethers v6: resolveWalletContext is async (provider.getSigner() is async in
    // v6), so wallet + contract construction can't happen in the (sync)
    // constructor. Stash the options and lazily resolve them once, on first use,
    // via _ensureWallet(). We do NOT keep walletOptions as an enumerable field
    // (so a raw private key isn't trivially serialised off the instance).
    Object.defineProperty(this, '_walletOptions', {
      value: walletOptions || {},
      enumerable: false,
      writable: true
    });
    this.walletContext = null;
    this._walletReady = null;
    this.resetState();
  }

  // Idempotently resolve the wallet context and build the contracts. Safe to
  // call multiple times / concurrently -- the first call does the work and the
  // rest await the same promise. Every public async entry point awaits this.
  async _ensureWallet() {
    if (this.walletContext) return;
    if (!this._walletReady) {
      this._walletReady = (async () => {
        this.walletContext = await resolveWalletContext(this.networkAddress, this._walletOptions);
        this._walletOptions = {}; // drop the raw options (incl. any private key)
        this.initializeContracts();
        // An explicit encryption public key (or one derived from a raw private
        // key) lets us skip the MetaMask-only eth_getEncryptionPublicKey call.
        if (this.walletContext.encryptionPublicKey) {
          this.publicKey = this.walletContext.encryptionPublicKey;
        }
      })();
    }
    await this._walletReady;
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
      // ethers v6: net.chainId is a bigint. Coerce to Number so it matches the
      // numeric keys in ECEcldTestnetConfig / ECNetworkByChainIdDictionary.
      chainId = net && net.chainId != null ? Number(net.chainId) : undefined;
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
    const reason = ethers.toUtf8String(`0x${code.substring(138)}`);
    //console.log(reason);
    return reason.trim();
  }

  // eslint-disable-next-line class-methods-use-this
  async waitForTransactionToBeProcessed(tx, protocolEvent) {
    while (true) {
      try {
        this.dispatchECEvent(`TX:` + util.inspect(tx, {depth: null}), ECLog.DEBUG);
        const txReceipt = await tx.wait();
        this.dispatchECEvent(`RECEIPT:` + util.inspect(txReceipt, {depth: null}), ECLog.DEBUG);
  
        const events = txReceipt.events.find(event => event.event === protocolEvent);
        this.dispatchECEvent(`EVENTS:` + util.inspect(events, {depth: null}), ECLog.DEBUG);
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
    while (true) {
      try {
        const order = await this.protocolContract.getOrder(this.orderId);
        this.dispatchECEvent(`Order:` + util.inspect(order,{depth: null}), ECLog.DEBUG);
        if (parseInt(order.status) == 1) {
          this.dispatchECEvent(`Task ${this.orderId} is still processing...`, ECLog.DEBUG);
          await delay(5000);
        } else {
          this.dispatchECEvent(`Task ${this.orderId} status is ${order.status}, continuing`, ECLog.DEBUG);
          return true;
        }
      }
      catch (e) {
        this.dispatchECEvent(`Error while waiting for task to be processed: ${e.message}`, ECLog.WARNING);
        await delay(1000);
      }
    }
  }

  getOrderResult = async () => {
    this.dispatchECEvent(`Task ${this.orderId} was successfully processed.`);
    const parsedOrderResult = await this.getResultFromOrder();
    if (parsedOrderResult.success === false) {
      this.status = ECStatus.ERROR;
      this.progress = ECEvent.FINISHED;
      this.dispatchECEvent(parsedOrderResult.message);
      throw new Error(parsedOrderResult.message);
    } else {
      this.result = parsedOrderResult.result;
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
    while (true) {
      try {
        const protocolContract = this.protocolContract.getContract();
        const ordersCount = await protocolContract._getOrdersCount();
        this.dispatchECEvent(`Orders count: ${ordersCount}`, ECLog.DEBUG);

        for (let i = ordersCount - 1; i >= this.ordersOffset; i--) {
          const order = await protocolContract._getOrder(i);
          this.dispatchECEvent(`Checking order: ` + util.inspect(order, {depth: null}), ECLog.DEBUG);
          this.dispatchECEvent(`Checking if: ${order.doRequest} == ${this.doRequest}`, ECLog.DEBUG);
          if (parseInt(order.doRequest) === parseInt(this.doRequest)) {
            this.dispatchECEvent(`Found order with orderId: ${i}`, ECLog.DEBUG);
            this.orderId = i;
            this.order = order;
            this.progress = ECEvent.ORDER_PLACED;
            this.dispatchECEvent(`Connected!`);
            return true;
          }
          await delay(200);
        }
        await delay(1000);
        continue;
      }
      catch(e){
        this.dispatchECEvent(`Failed to find order: ` + e.message, ECLog.WARNING);
        await delay(1000);
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
        taskCodeString: ECOrderTaskStatus[arr[1]],
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
        return { success: false, message: 'Task processing failed, no IPFS hash returned' };
      }

      this.dispatchECEvent(`Downloading: ${parsedOrderResult.resultIPFSHash}`);
      this.progress = ECEvent.VERIFYING;
      // parse the transaction bytes of the order result
      const transactionResult = this.parseTransactionBytes(parsedOrderResult.transactionBytes);

      // generate a wallet address using the `challengeHash` and `transactionResult.enclaveChallenge`
      const wallet = generateWallet(this.challengeHash, transactionResult.enclaveChallenge);
      // check if the generated wallet address matches the `transactionResult.from` address
      if (!wallet || wallet !== transactionResult.from) {
        return { success: false, message: 'Integrity check failed, signer wallet address is wrong.' };
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
        return { success: false, message: 'Could not decrypt the order result.' };
      }

      // update the loading message to show the result value
      //this.dispatchECEvent(`Result value: ${decryptedData.data}`);
      // calculate the SHA-256 checksum of the result value
      const ipfsResultChecksum = sha256(decryptedData.data);
      // check if the calculated checksum matches the `transactionResult.checksum`
      if (ipfsResultChecksum !== transactionResult.checksum) {
        return { success: false, message: 'Integrity check failed, checksum of the order result is wrong.' };
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
        return { success: false, message: 'Ethernity parsing transaction error.' };
      }
      if (ex.name === ECError.IPFS_DOWNLOAD_ERROR) {
        return { success: false, message: 'Ethernity IPFS download result error.' };
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

  async run(resources, secureLockEnclave, code, nodeAddress = '', trustedZoneEnclave = 'etny-nodenithy-testnet') {
    try {
      // ethers v6: resolve the wallet + build contracts before anything uses
      // them (deferred from the constructor because getSigner() is async).
      await this._ensureWallet();
      this.resources = resources;
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
