import * as ipfsClient from './ipfs';
import { delay, formatDate, generateRandomHexOfSize } from './utils';
import { decryptWithPrivateKey, encryptWithCertificate, sha256 } from './crypto';
import EtnyContract from './contract/operation/etnyContract';
import ImageRegistryContract from './contract/operation/imageRegistryContract';
import contract from './contract/abi/etnyAbi';
import { ECEvent, ECStatus, ECOrderTaskStatus, ZERO_CHECKSUM, MAINNET_ADDRESS } from './enums';

const { Buffer } = require('buffer/');

const LAST_BLOCKS = 20;
const VERSION = 'v3';

class EthernityCloudRunner extends EventTarget {
  nodeAddress = '';

  __orderNumber = -1;

  __doHash = null;

  __doRequestId = -1;

  __doRequest = -1;

  __scriptHash = '';

  __fileSetHash = '';

  interval = null;

  findOrderRepeats = 1;

  getResultFromOrderRepeats = 1;

  runnerType = null;

  enclaveImageIPFSHash = '';

  enclaveDockerComposeIPFSHash = '';

  enclavePublicKey = '';

  etnyContract = null;

  imageRegistryContract = null;

  constructor() {
    super();
    this.etnyContract = new EtnyContract();
    this.imageRegistryContract = new ImageRegistryContract();
  }

  // eslint-disable-next-line class-methods-use-this
  initializeStorage(ipfsAddress, protocol, port, token) {
    ipfsClient.initialize(ipfsAddress, protocol, port, token);
  }

  // eslint-disable-next-line class-methods-use-this
  isMainnet = () => contract.address === MAINNET_ADDRESS;

  dispatchECEvent = (message, status = ECStatus.DEFAULT, type = ECEvent.TASK_PROGRESS) => {
    // Create a new custom event with a custom event name, and pass any data as the event detail
    const customEvent = new CustomEvent(type, { detail: { message, status } });

    // Dispatch the custom event on the current instance of the class (or any DOM element)
    this.dispatchEvent(customEvent);
  };

  async getEnclaveDetails() {
    const details = await this.imageRegistryContract.getEnclaveDetailsV3(this.runnerType, VERSION);
    if (details) {
      [this.enclaveImageIPFSHash, this.enclavePublicKey, this.enclaveDockerComposeIPFSHash] = details;
      this.dispatchECEvent(`ENCLAVE_IMAGE_IPFS_HASH:${this.enclaveImageIPFSHash}`);
      this.dispatchECEvent(`ENCLAVE_PUBLIC_KEY:${this.enclavePublicKey}`);
      this.dispatchECEvent(`ENCLAVE_DOCKER_COMPOSE_IPFS_HASH:${this.enclaveDockerComposeIPFSHash}`);
    }
  }

  getTokensFromFaucet = async () => {
    const account = this.etnyContract.getCurrentWallet();
    const balance = await this.etnyContract.getBalance(account);
    if (parseInt(balance, 10) <= 100) {
      const tx = await this.etnyContract.getFaucetTokens(account);
      const transactionHash = tx.hash;
      const isProcessed = await this.waitForTransactionToBeProcessed(transactionHash);
      if (!isProcessed) {
        return { success: false, message: 'Unable to create request, please check connectivity with Bloxberg node' };
      }
      return { success: true };
    }
    return { success: true };
  };

  async waitForTransactionToBeProcessed(transactionHash) {
    await this.etnyContract.getProvider().waitForTransaction(transactionHash);
    const txReceipt = await this.etnyContract.getProvider().getTransactionReceipt(transactionHash);
    return !(!txReceipt && txReceipt.status === 0);
  }

  async connectToMetaMaskAndSign() {
    try {
      await this.etnyContract.getProvider().send('eth_requestAccounts', []);
      const walletAddress = this.etnyContract.getCurrentWallet();
      return walletAddress !== null && walletAddress !== undefined;
    } catch (e) {
      return false;
    }
  }

  async listenForAddDORequestEvent() {
    let intervalRepeats = 0;
    let _addDORequestEVPassed = false;
    let _orderPlacedEVPassed = false;
    let _orderClosedEVPassed = false;

    const contract = this.etnyContract.getContract();
    const messageInterval = () => {
      if (intervalRepeats % 2 === 0) {
        this.dispatchECEvent(`\\ Waiting for the task to be processed by ${this.nodeAddress} ...`);
      } else {
        this.dispatchECEvent(`/ Waiting for the task to be processed by ${this.nodeAddress} ...`);
      }
      // eslint-disable-next-line no-plusplus
      intervalRepeats++;
    };

    const _orderApproved = async () => {
      _orderPlacedEVPassed = true;
      contract.off('_orderPlacedEV', _orderPlacedEV);

      // approve order in case we are not providing a node address as metadata4 parameter
      if (!this.nodeAddress) {
        await this.approveOrder(this.__orderNumber);
      }

      this.dispatchECEvent(`Order ${this.__orderNumber} was placed and approved.`);
      this.interval = setInterval(messageInterval, 1000);
    };

    const _addDORequestEV = async (_from, _doRequest) => {
      const walletAddress = (await this.etnyContract.getProvider().send('eth_requestAccounts', []))[0];
      try {
        if (walletAddress && _from.toLowerCase() === walletAddress.toLowerCase() && !_addDORequestEVPassed) {
          this.__doRequest = _doRequest.toNumber();
          this.dispatchECEvent(`Task was picked up and DO Request ${this.__doRequest} was created.`);
          _addDORequestEVPassed = true;
          contract.off('_addDORequestEV', _addDORequestEV);

          // in case _orderPlacedEV was dispatched before _addDORequestEV we have to call the _orderApproved
          if (this.__orderNumber !== -1 && this.__doRequest === this.__doRequestId) {
            await _orderApproved();
          }
        } else if (!walletAddress) {
          this.dispatchECEvent('Unable to retrieve current wallet address.');
        }
      } catch (e) {
        console.log(e);
        this.dispatchECEvent('Unable to retrieve current wallet address.', ECStatus.ERROR);
      }
    };

    const _orderPlacedEV = async (orderNumber, doRequestId) => {
      // this means that addDPRequestEV was dispatched
      if (doRequestId.toNumber() === this.__doRequest && !_orderPlacedEVPassed && this.__doRequest !== -1) {
        this.__orderNumber = orderNumber.toNumber();
        this.__doRequestId = doRequestId.toNumber();
        await _orderApproved();
      } else {
        // otherwise keep track of the result of this event and call the function _orderApproved in addDPRequestEV
        // eslint-disable-next-line no-lonely-if
        if (this.__doRequest === -1) {
          this.__orderNumber = orderNumber.toNumber();
          this.__doRequestId = doRequestId.toNumber();
        }
      }
    };

    const _orderClosedEV = async (orderNumber) => {
      if (this.__orderNumber === orderNumber.toNumber() && !_orderClosedEVPassed && this.__orderNumber !== -1) {
        clearInterval(this.interval);
        _orderClosedEVPassed = true;
        contract.off('_orderClosedEV', _orderClosedEV);

        // get processed result from the order and create a certificate
        const parsedOrderResult = await this.getResultFromOrder(orderNumber);
        if (parsedOrderResult.success === false) {
          this.dispatchECEvent(parsedOrderResult.message, ECStatus.ERROR);
        } else {
          this.dispatchECEvent(
            {
              result: parsedOrderResult.result,
              resultHash: parsedOrderResult.resultHash,
              resultValue: parsedOrderResult.resultValue,
              resultValueTimestamp: parsedOrderResult.resultTimestamp,
              resultTaskCode: parsedOrderResult.resultTaskCode
            },
            ECStatus.SUCCESS,
            ECEvent.TASK_COMPLETED
          );
        }
      }
    };

    contract.on('_addDORequestEV', _addDORequestEV);
    contract.on('_orderPlacedEV', _orderPlacedEV);
    contract.on('_orderClosedEV', _orderClosedEV);
  }

  async approveOrder(orderId) {
    const tx = await this.etnyContract.approveOrder(orderId);
    const isProcessed = await this.waitForTransactionToBeProcessed(tx.hash);
    if (!isProcessed) {
      this.dispatchECEvent('Unable to approve order, please check connectivity with Bloxberg node', ECStatus.ERROR);
      return;
    }

    this.dispatchECEvent(`Order successfully approved!`, ECStatus.SUCCESS);
    this.dispatchECEvent(`TX hash: ${tx.hash}`);

    this.nodeAddress = (await this.etnyContract.getOrder(orderId)).dproc;
  }

  async getCurrentWalletPublicKey() {
    const account = this.etnyContract.getCurrentWallet();
    const keyB64 = await window.ethereum.request({
      method: 'eth_getEncryptionPublicKey',
      params: [account]
    });
    return Buffer.from(keyB64, 'base64').toString('hex');
  }

  async getV3ImageMetadata(challengeHash) {
    // generating encrypted base64 hash of the challenge
    const base64EncryptedChallenge = await encryptWithCertificate(challengeHash, this.enclavePublicKey);

    // uploading to IPFS the base64 encrypted challenge
    const challengeIPFSHash = await ipfsClient.uploadToIPFS(base64EncryptedChallenge);

    const publicKey = await this.getCurrentWalletPublicKey();
    // image metadata for v3 format v3:image_ipfs_hash:image_name:docker_compose_ipfs_hash:client_challenge_ipfs_hash:public_key
    return `${VERSION}:${this.enclaveImageIPFSHash}:${this.runnerType}:${this.enclaveDockerComposeIPFSHash}:${challengeIPFSHash}:${publicKey}`;
  }

  async getV3CodeMetadata(code) {
    // extracting code from all the code cells
    let scriptChecksum = sha256(code);
    // uploading all node js code to IPFS and received hash of transaction
    const base64EncryptedScript = await encryptWithCertificate(code, this.enclavePublicKey);
    this.__scriptHash = await ipfsClient.uploadToIPFS(base64EncryptedScript);

    scriptChecksum = await this.etnyContract.signMessage(scriptChecksum);
    // v3:code_ipfs_hash:code_checksum
    return `${VERSION}:${this.__scriptHash}:${scriptChecksum}`;
  }

  async getV3InputMedata() {
    const fileSetChecksum = await this.etnyContract.signMessage(ZERO_CHECKSUM);
    // v3::filesetchecksum
    return `${VERSION}::${fileSetChecksum}`;
  }

  async createDORequest(imageMetadata, codeMetadata, inputMetadata, nodeAddress) {
    this.dispatchECEvent(`Submitting transaction for DO request on ${formatDate()}`);
    // add here call to SC(smart contract)
    const tx = await this.etnyContract.addDORequest(imageMetadata, codeMetadata, inputMetadata, nodeAddress);
    const transactionHash = tx.hash;
    this.__doHash = transactionHash;

    this.dispatchECEvent(`Waiting for transaction ${transactionHash} to be processed...`);
    const isProcessed = await this.waitForTransactionToBeProcessed(transactionHash);
    if (!isProcessed) {
      this.dispatchECEvent('Unable to create request, please check connectivity with Bloxberg node');
      return;
    }
    this.dispatchECEvent(`Transaction ${transactionHash} was confirmed`);
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
      throw new Error('EtnyParseError');
    }
  };

  parseTransactionBytes(bytes) {
    try {
      const result = this.etnyContract.parseTransactionBytes(bytes);
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
      throw new Error('EtnyParseError');
    }
  }

  async getResultFromOrder(orderId) {
    try {
      // get the result of the order using the `etnyContract` object
      const orderResult = await this.etnyContract.getResultFromOrder(orderId);
      this.dispatchECEvent(`Task with order number ${orderId} was successfully processed at ${formatDate()}`);

      // parse the order result
      const parsedOrderResult = this.parseOrderResult(orderResult);
      this.dispatchECEvent(`Result IPFS hash: ${parsedOrderResult.resultIPFSHash}`);
      // parse the transaction bytes of the order result
      const transactionResult = this.parseTransactionBytes(parsedOrderResult.transactionBytes);

      // generate a wallet address using the `challengeHash` and `transactionResult.enclaveChallenge`
      const wallet = this.etnyContract.generateWallet(this.challengeHash, transactionResult.enclaveChallenge);
      // check if the generated wallet address matches the `transactionResult.from` address
      if (!wallet || wallet !== transactionResult.from) {
        return { success: false, message: 'Integrity check failed, signer wallet address is wrong.' };
      }

      // get the result value from IPFS using the `parsedOrderResult.resultIPFSHash`
      const ipfsResult = await ipfsClient.getFromIPFS(parsedOrderResult.resultIPFSHash);
      // decrypt data
      const currentWalletAddress = this.etnyContract.getCurrentWallet();
      const decryptedData = await decryptWithPrivateKey(ipfsResult, currentWalletAddress);

      if (!decryptedData.success) {
        return { success: false, message: 'Could not decrypt the order result.' };
      }

      // update the loading message to show the result value
      this.dispatchECEvent(`Result value: ${decryptedData.data}`);
      // calculate the SHA-256 checksum of the result value
      const ipfsResultChecksum = sha256(decryptedData.data);
      // check if the calculated checksum matches the `transactionResult.checksum`
      if (ipfsResultChecksum !== transactionResult.checksum) {
        return { success: false, message: 'Integrity check failed, checksum of the order result is wrong.' };
      }

      // get the original input transaction hash and the output transaction hash for the order
      const transaction = await this.etnyContract.getProvider().getTransaction(this.__doHash);
      const block = await this.etnyContract.getProvider().getBlock(transaction.blockNumber);
      const blockTimestamp = block.timestamp;
      const endBlockNumber = await this.etnyContract.getProvider().getBlockNumber();
      const startBlockNumber = endBlockNumber - LAST_BLOCKS;
      //
      let resultTransactionHash;
      let resultBlockTimestamp;

      // eslint-disable-next-line no-plusplus
      for (let i = endBlockNumber; i >= startBlockNumber; i--) {
        // eslint-disable-next-line no-await-in-loop
        const block = await this.etnyContract.getProvider().getBlockWithTransactions(i);
        // eslint-disable-next-line no-continue
        if (!block || !block.transactions) continue;

        // eslint-disable-next-line no-restricted-syntax
        for (const transaction of block.transactions) {
          if (transaction.to === this.etnyContract.contractAddress() && transaction.data) {
            resultTransactionHash = transaction.hash;
            resultBlockTimestamp = block.timestamp;
          }
        }
      }

      return {
        success: true,
        contractAddress: this.etnyContract.contractAddress(),
        inputTransactionHash: this.__doHash,
        outputTransactionHash: resultTransactionHash,
        orderId,
        imageHash: `${this.enclaveImageIPFSHash}:${this.runnerType}`,
        scriptHash: this.__scriptHash,
        fileSetHash: this.__fileSetHash,
        publicTimestamp: blockTimestamp,
        resultHash: parsedOrderResult.resultIPFSHash,
        resultTaskCode: transactionResult.taskCodeString,
        resultValue: ipfsResult,
        resultTimestamp: resultBlockTimestamp,
        result: decryptedData.data
      };
    } catch (ex) {
      if (ex.name === 'EtnyParseError') {
        return { success: false, message: 'Ethernity Parsing Error' };
      }
      await delay(5000);
      this.getResultFromOrderRepeats += 1;
      // eslint-disable-next-line no-return-await
      return await this.getResultFromOrder(orderId);
    }
  }

  async processTask(code) {
    await this.listenForAddDORequestEvent();
    this.challengeHash = generateRandomHexOfSize(20);
    // getting image metadata
    const imageMetadata = await this.getV3ImageMetadata(this.challengeHash);
    // // getting script metadata
    const codeMetadata = await this.getV3CodeMetadata(code);
    // // getting input metadata
    const inputMetadata = await this.getV3InputMedata();
    // // create new DO Request
    await this.createDORequest(imageMetadata, codeMetadata, inputMetadata, this.nodeAddress);
  }

  reset = () => {
    this.__orderNumber = -1;
    this.__doHash = null;
    this.__doRequestId = -1;
    this.__doRequest = -1;
    this.__scriptHash = '';
    this.__fileSetHash = '';
    this.interval = null;
    this.findOrderRepeats = 1;
    this.getResultFromOrderRepeats = 1;
  };

  cleanup = async () => {
    this.reset();
    const contract = this.etnyContract.getContract();
    contract.removeAllListeners();
  };

  isNodeOperatorAddress = async (nodeAddress) => {
    if (nodeAddress === '' || !nodeAddress) return true;
    if (this.etnyContract.isAddress(nodeAddress)) {
      const isNode = await this.etnyContract.isNodeOperator(nodeAddress);
      if (!isNode) {
        this.dispatchECEvent('Introduced address is not a valid node operator address', ECStatus.ERROR);
        return false;
      }
      return true;
    }
    this.dispatchECEvent('Introduced address is not a valid wallet address', ECStatus.ERROR);
    return false;
  };

  async run(runnerType, code, nodeAddress) {
    try {
      this.nodeAddress = nodeAddress;
      const isNodeOperatorAddress = await this.isNodeOperatorAddress(nodeAddress);
      if (isNodeOperatorAddress) {
        this.runnerType = runnerType;

        await this.cleanup();
        this.dispatchECEvent('Started processing task...');

        await this.etnyContract.initialize();
        await this.imageRegistryContract.initialize();

        const connected = await this.connectToMetaMaskAndSign();
        if (connected) {
          await this.getEnclaveDetails();
          if (!this.isMainnet) await this.getTokensFromFaucet();

          await this.processTask(code);
        } else {
          this.dispatchECEvent('Unable to connect to MetaMask', ECStatus.ERROR);
        }
      }
    } catch (e) {
      this.dispatchECEvent(e.message, ECStatus.ERROR);
    }
  }
}

export default EthernityCloudRunner;