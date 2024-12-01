import { ethers } from 'ethers';
import * as ipfsClient from './ipfs';
import {
  delay,
  formatDate,
  generateRandomHexOfSize,
  generateWallet,
  isAddress,
  isNullOrEmpty,
  parseTransactionBytes
} from './utils';
import { decryptWithPrivateKey, encryptWithCertificate, sha256 } from './crypto';
import EtnyContract from './contract/operation/etnyContract';
import EcldContract from './contract/operation/ecldContract';
import ImageRegistryContract from './contract/operation/imageRegistryContract';
import contractBloxberg from './contract/abi/etnyAbi';
import protocolContractPolygon from './contract/abi/polygonProtocolAbi';
import {
  ECEvent,
  ECStatus,
  ECLog,
  ECOrderTaskStatus,
  ZERO_CHECKSUM,
  ECAddress,
  ECError,
  ECRunner,
  ECNetworkName
} from './enums';
import PolygonProtocolContract from './contract/operation/polygonProtocolContract';
import BloxbergProtocolContract from './contract/operation/bloxbergProtocolContract';

const { Buffer } = require('buffer/');
const util = require('util');

const LAST_BLOCKS = 20;
const VERSION = 'v3';

class EthernityCloudRunner extends EventTarget {
  constructor(networkAddress = ECAddress.BLOXBERG.TESTNET_ADDRESS) {
    super();
    this.networkAddress = networkAddress;
    this.initializeContracts();
    this.resetState();
  }

  initializeContracts() {
    switch (this.networkAddress) {
      case ECAddress.BLOXBERG.TESTNET_ADDRESS:
      case ECAddress.BLOXBERG.MAINNET_ADDRESS:
        this.tokenContract = new EtnyContract(this.networkAddress);
        this.protocolContract = new BloxbergProtocolContract(this.networkAddress);
        this.protocolAbi = contractBloxberg.abi;
        break;
      case ECAddress.POLYGON.MAINNET_ADDRESS:
      case ECAddress.POLYGON.TESTNET_ADDRESS:
        this.tokenContract = new EcldContract(this.networkAddress);
        this.protocolContract = new PolygonProtocolContract(
          this.networkAddress === ECAddress.POLYGON.MAINNET_ADDRESS
            ? ECAddress.POLYGON.MAINNET_PROTOCOL_ADDRESS
            : ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS
        );
        this.protocolAbi = protocolContractPolygon.abi;
        break;
      default:
        throw new Error('Invalid network address');
    }
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
    this.imageRegistryContract = new ImageRegistryContract(this.networkAddress, 'etny-pynithy-testnet');
    await this.getEnclaveDetails();
  }

  async initializeWeb3Connection() {
    await this.tokenContract.initialize();
    if (!await this.handleWeb3Connection()) {
      throw new Error('Unable to connect to Web3');
    }
  }

  async checkAllowance(taskPrice) {
    if (this.networkAddress === ECAddress.POLYGON.MAINNET_ADDRESS ||
        this.networkAddress === ECAddress.POLYGON.TESTNET_ADDRESS) {
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

  isMainnet = () =>
    this.networkAddress === ECAddress.BLOXBERG.MAINNET_ADDRESS ||
    this.networkAddress === ECAddress.POLYGON.MAINNET_ADDRESS;

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

  async getEnclaveDetails() {
    const details = await this.imageRegistryContract.getEnclaveDetailsV3(this.secureLockEnclave, VERSION);
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
      await this.tokenContract.getProvider().send('eth_requestAccounts', []);
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
    await this.tokenContract.initialize();
    const account = this.tokenContract.getCurrentWallet();
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

    this.dispatchECEvent(`Uploaded encrypted code to IPFS: ${this.scriptHash}`);

    // scriptChecksum = await this.tokenContract.signMessage(scriptChecksum);
    // v3:code_ipfs_hash:code_checksum
    return `${VERSION}:${this.scriptHash}:${scriptChecksum}`;
  }

  async getV3InputMedata() {
    let  fileSetChecksum = sha256(ZERO_CHECKSUM);
    // fileSetChecksum = await this.tokenContract.signMessage(fileSetChecksum);
    // v3::filesetchecksum
    return `${VERSION}::${fileSetChecksum}`;
  }


  createDORequest = async (imageMetadata, codeMetadata, inputMetadata) => {
    try {
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
      const decryptedData = await decryptWithPrivateKey(ipfsResult, currentWalletAddress);

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
      //console.log(networkName);
      // eslint-disable-next-line default-case
      switch (this.networkAddress) {
        case ECAddress.BLOXBERG.MAINNET_ADDRESS:
        case ECAddress.BLOXBERG.TESTNET_ADDRESS:
          if (networkName !== ECNetworkName.BLOXBERG) {
            this.status = ECStatus.ERROR;
            this.dispatchECEvent(`Please switch Web3 network and use Bloxberg!`);
            throw new Error(`Please switch Web3 network and use Bloxberg!`);
          }
          break;
        case ECAddress.POLYGON.MAINNET_ADDRESS:
          if (networkName !== ECNetworkName.POLYGON) {
            this.status = ECStatus.ERROR;
            this.dispatchECEvent(`Please switch Web3 network and use Polygon!`);
            throw new Error(`Please switch Web3 network and use Polygon!`);
          }
          break;
        case ECAddress.POLYGON.TESTNET_ADDRESS:
          if (networkName !== ECNetworkName.MUMBAI) {
            this.status = ECStatus.ERROR;
            this.dispatchECEvent(`Please switch Web3 network and use Amoy!`);
            throw new Error(`Please switch Web3 network and use Amoy!`);
          }
          break;
      }

      const runnerNetworkName = ECNetworkNameDictionary[this.networkAddress];
      return networkName === runnerNetworkName;
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
      this.resources = resources;
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
