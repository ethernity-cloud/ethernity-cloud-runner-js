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
  ECOrderTaskStatus,
  ZERO_CHECKSUM,
  ECAddress,
  ECError,
  ECNetworkName,
  ECNetworkNameDictionary,
  ECNetworkName1Dictionary
} from './enums';
import PolygonProtocolContract from './contract/operation/polygonProtocolContract';
import BloxbergProtocolContract from './contract/operation/bloxbergProtocolContract';

const { Buffer } = require('buffer/');

const LAST_BLOCKS = 20;
const VERSION = 'v3';

class EthernityCloudRunner extends EventTarget {
  #nodeAddress = '';

  #challengeHash = '';

  #orderNumber = -1;

  #doHash = null;

  #doRequestId = -1;

  #doRequest = -1;

  #scriptHash = '';

  #fileSetHash = '';

  #interval = null;

  #orderPlacedTimer = null;

  #taskHasBeenPickedForApproval = false;

  #getResultFromOrderRepeats = 1;

  #runnerType = null;

  #networkAddress = null;

  #resource = 0;

  #enclaveImageIPFSHash = '';

  #enclavePublicKey = '';

  #enclaveDockerComposeIPFSHash = '';

  #tokenContract = null;

  #protocolContract = null;

  #protocolAbi = null;

  #imageRegistryContract = null;

  constructor(networkAddress = ECAddress.BLOXBERG.TESTNET_ADDRESS) {
    if (!EthernityCloudRunner.instance) {
      super();

      this.#networkAddress = networkAddress;
      switch (networkAddress) {
        case ECAddress.BLOXBERG.TESTNET_ADDRESS:
        case ECAddress.BLOXBERG.MAINNET_ADDRESS:
          this.#tokenContract = new EtnyContract(networkAddress);
          this.#protocolContract = new BloxbergProtocolContract(networkAddress);
          this.#protocolAbi = contractBloxberg.abi;
          break;
        case ECAddress.POLYGON.MAINNET_ADDRESS:
          this.#tokenContract = new EcldContract(networkAddress);
          this.#protocolContract = new PolygonProtocolContract(ECAddress.POLYGON.MAINNET_PROTOCOL_ADDRESS);
          this.#protocolAbi = protocolContractPolygon.abi;
          break;
        case ECAddress.POLYGON.TESTNET_ADDRESS:
          this.#tokenContract = new EcldContract(networkAddress);
          console.log(ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS);
          this.#protocolContract = new PolygonProtocolContract(ECAddress.POLYGON.TESTNET_PROTOCOL_ADDRESS);
          this.#protocolAbi = protocolContractPolygon.abi;
          break;
        default:
      }

      EthernityCloudRunner.instance = this;
    }

    // eslint-disable-next-line no-constructor-return
    return EthernityCloudRunner.instance;
  }

  #isMainnet = () =>
    this.#networkAddress === ECAddress.BLOXBERG.MAINNET_ADDRESS ||
    this.#networkAddress === ECAddress.POLYGON.MAINNET_ADDRESS;

  #dispatchECEvent = (message, status = ECStatus.DEFAULT, type = ECEvent.TASK_PROGRESS) => {
    // Create a new custom event with a custom event name, and pass any data as the event detail
    const customEvent = new CustomEvent(type, { detail: { message, status } });

    // Dispatch the custom event on the current instance of the class (or any DOM element)
    this.dispatchEvent(customEvent);
  };

  async #getEnclaveDetails() {
    const details = await this.#imageRegistryContract.getEnclaveDetailsV3(this.#runnerType, VERSION);
    if (details) {
      [this.#enclaveImageIPFSHash, this.#enclavePublicKey, this.#enclaveDockerComposeIPFSHash] = details;
      this.#dispatchECEvent(`ENCLAVE_IMAGE_IPFS_HASH:${this.#enclaveImageIPFSHash}`);
      this.#dispatchECEvent(`ENCLAVE_PUBLIC_KEY:${this.#enclavePublicKey}`);
      this.#dispatchECEvent(`ENCLAVE_DOCKER_COMPOSE_IPFS_HASH:${this.#enclaveDockerComposeIPFSHash}`);
    }
  }

  #getTokensFromFaucet = async () => {
    const account = this.#tokenContract.getCurrentWallet();
    const balance = await this.#tokenContract.getBalance(account);
    if (parseInt(balance, 10) <= 100) {
      const tx = await this.#tokenContract.getFaucetTokens(account);
      const transactionHash = tx.hash;
      const isProcessed = await this.#waitForTransactionToBeProcessed(this.#tokenContract, transactionHash);
      if (!isProcessed) {
        return { success: false, message: 'Unable to create request, please check connectivity with Bloxberg node.' };
      }
      return { success: true };
    }
    return { success: true };
  };

  // eslint-disable-next-line class-methods-use-this
  async #getReason(contract, txHash) {
    const tx = await contract.getProvider().getTransaction(txHash);
    if (!tx) {
      console.log('tx not found');
      return 'Transaction hash not found';
    }
    delete tx.gasPrice;
    const code = await contract.getProvider().call(tx, tx.blockNumber);
    const reason = ethers.utils.toUtf8String(`0x${code.substring(138)}`);
    console.log(reason);
    return reason.trim();
  }

  // eslint-disable-next-line class-methods-use-this
  async #waitForTransactionToBeProcessed(contract, transactionHash) {
    await contract.getProvider().waitForTransaction(transactionHash);
    const txReceipt = await contract.getProvider().getTransactionReceipt(transactionHash);
    console.log(txReceipt);
    return !(!txReceipt && txReceipt.status === 0);
  }

  async #handleMetaMaskConnection() {
    try {
      await this.#tokenContract.getProvider().send('eth_requestAccounts', []);
      const walletAddress = this.#tokenContract.getCurrentWallet();
      return walletAddress !== null && walletAddress !== undefined;
    } catch (e) {
      return false;
    }
  }

  async #listenForAddDORequestEvent() {
    let intervalRepeats = 0;
    let _addDORequestEVPassed = false;
    let _orderPlacedEVPassed = false;
    let _orderClosedEVPassed = false;

    const protocolContract = this.#protocolContract.getContract();
    const messageInterval = () => {
      if (intervalRepeats % 2 === 0) {
        this.#dispatchECEvent(`\\ Waiting for the task to be processed by ${this.#nodeAddress} ...`);
      } else {
        this.#dispatchECEvent(`/ Waiting for the task to be processed by ${this.#nodeAddress} ...`);
      }
      // eslint-disable-next-line no-plusplus
      intervalRepeats++;
    };

    const _orderApproved = async () => {
      _orderPlacedEVPassed = true;
      protocolContract.off('_orderPlacedEV', _orderPlacedEV);

      // approve order in case we are not providing a node address as metadata4 parameter
      if (!this.#nodeAddress) {
        await this.#approveOrder(this.#orderNumber);
      }

      this.#dispatchECEvent(`Order ${this.#orderNumber} was placed and approved.`);
      this.#dispatchECEvent(
        `Order ${this.#orderNumber} was placed and approved.`,
        ECStatus.DEFAULT,
        ECEvent.TASK_ORDER_PLACED
      );
      this.#interval = setInterval(messageInterval, 1000);
    };

    const _addDORequestEV = async (_from, _doRequest) => {
      const walletAddress = (await this.#tokenContract.getProvider().send('eth_requestAccounts', []))[0];
      try {
        if (walletAddress && _from.toLowerCase() === walletAddress.toLowerCase() && !_addDORequestEVPassed) {
          this.#doRequest = _doRequest.toNumber();
          this.#dispatchECEvent(`Task was picked up and DO Request ${this.#doRequest} was created.`);
          _addDORequestEVPassed = true;
          protocolContract.off('_addDORequestEV', _addDORequestEV);
          this.#dispatchECEvent(
            `Task was picked up and DO Request ${this.#doRequest} was created.`,
            ECStatus.DEFAULT,
            ECEvent.TASK_CREATED
          );

          // in case _orderPlacedEV was dispatched before _addDORequestEV we have to call the _orderApproved
          if (this.#orderNumber !== -1 && this.#doRequest === this.#doRequestId) {
            await _orderApproved();
          }

          const showErrorAfterTimeout = () => {
            this.#dispatchECEvent(
              'Task processing failed due to unavailability of nodes. The network is currently busy. Please consider increasing the task price.',
              ECStatus.ERROR
            );
            this.#dispatchECEvent(
              'Task processing failed due to unavailability of nodes. The network is currently busy. Please consider increasing the task price.',
              ECStatus.ERROR,
              ECEvent.TASK_NOT_PROCESSED
            );
          };

          // checking if task was picked for approval and passed resource requirements
          clearTimeout(this.#orderPlacedTimer);
          this.#orderPlacedTimer = setTimeout(() => {
            if (!this.#taskHasBeenPickedForApproval) {
              showErrorAfterTimeout();
            }
            clearTimeout(this.#orderPlacedTimer);
          }, 60 * 1000);
        } else if (!walletAddress) {
          this.#dispatchECEvent('Unable to retrieve current wallet address.', ECStatus.ERROR);
        }
      } catch (e) {
        console.log(e);
        this.#dispatchECEvent('Unable to retrieve current wallet address.', ECStatus.ERROR);
      }
    };

    const _orderPlacedEV = async (orderNumber, doRequestId) => {
      this.#taskHasBeenPickedForApproval = true;
      // this means that addDPRequestEV was dispatched
      if (doRequestId.toNumber() === this.#doRequest && !_orderPlacedEVPassed && this.#doRequest !== -1) {
        this.#orderNumber = orderNumber.toNumber();
        this.#doRequestId = doRequestId.toNumber();
        await _orderApproved();
      } else {
        // otherwise keep track of the result of this event and call the function _orderApproved in addDPRequestEV
        // eslint-disable-next-line no-lonely-if
        if (this.#doRequest === -1) {
          this.#orderNumber = orderNumber.toNumber();
          this.#doRequestId = doRequestId.toNumber();
        }
      }
    };

    const _orderClosedEV = async (orderNumber) => {
      if (this.#orderNumber === orderNumber.toNumber() && !_orderClosedEVPassed && this.#orderNumber !== -1) {
        clearInterval(this.#interval);
        _orderClosedEVPassed = true;
        protocolContract.off('_orderClosedEV', _orderClosedEV);

        // get processed result from the order and create a certificate
        const parsedOrderResult = await this.#getResultFromOrder(orderNumber);
        if (parsedOrderResult.success === false) {
          this.#dispatchECEvent(parsedOrderResult.message, ECStatus.ERROR);
        } else {
          this.#dispatchECEvent(
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

    protocolContract.on('_addDORequestEV', _addDORequestEV);
    protocolContract.on('_orderPlacedEV', _orderPlacedEV);
    protocolContract.on('_orderClosedEV', _orderClosedEV);
  }

  async #approveOrder(orderId) {
    const tx = await this.#protocolContract.approveOrder(orderId);
    const isProcessed = await this.#waitForTransactionToBeProcessed(this.#protocolContract, tx.hash);
    if (!isProcessed) {
      const reason = await this.#getReason(this.#protocolContract, tx.hash);
      this.#dispatchECEvent(`Unable to approve order. ${reason}`, ECStatus.ERROR);
      return;
    }

    this.#dispatchECEvent(`Order successfully approved!`, ECStatus.SUCCESS);
    this.#dispatchECEvent(`TX hash: ${tx.hash}`);

    this.#nodeAddress = (await this.#protocolContract.getOrder(orderId)).dproc;
  }

  async #getCurrentWalletPublicKey() {
    const account = this.#tokenContract.getCurrentWallet();
    const keyB64 = await window.ethereum.request({
      method: 'eth_getEncryptionPublicKey',
      params: [account]
    });
    return Buffer.from(keyB64, 'base64').toString('hex');
  }

  async #getV3ImageMetadata(challengeHash) {
    // generating encrypted base64 hash of the challenge
    const base64EncryptedChallenge = await encryptWithCertificate(challengeHash, this.#enclavePublicKey);

    // uploading to IPFS the base64 encrypted challenge
    const challengeIPFSHash = await ipfsClient.uploadToIPFS(base64EncryptedChallenge);

    const publicKey = await this.#getCurrentWalletPublicKey();
    // image metadata for v3 format v3:image_ipfs_hash:image_name:docker_compose_ipfs_hash:client_challenge_ipfs_hash:public_key
    return `${VERSION}:${this.#enclaveImageIPFSHash}:${this.#runnerType}:${
      this.#enclaveDockerComposeIPFSHash
    }:${challengeIPFSHash}:${publicKey}`;
  }

  async #getV3CodeMetadata(code) {
    // extracting code from all the code cells
    let scriptChecksum = sha256(code);
    // uploading all node js code to IPFS and received hash of transaction
    const base64EncryptedScript = await encryptWithCertificate(code, this.#enclavePublicKey);
    this.#scriptHash = await ipfsClient.uploadToIPFS(base64EncryptedScript);

    scriptChecksum = await this.#tokenContract.signMessage(scriptChecksum);
    // v3:code_ipfs_hash:code_checksum
    return `${VERSION}:${this.#scriptHash}:${scriptChecksum}`;
  }

  async #getV3InputMedata() {
    const fileSetChecksum = await this.#tokenContract.signMessage(ZERO_CHECKSUM);
    // v3::filesetchecksum
    return `${VERSION}::${fileSetChecksum}`;
  }

  async #createDORequest(imageMetadata, codeMetadata, inputMetadata, nodeAddress, gasLimit) {
    try {
      this.#dispatchECEvent(`Submitting transaction for DO request on ${formatDate()}.`);
      // add here call to SC(smart contract)
      const tx = await this.#protocolContract.addDORequest(
        imageMetadata,
        codeMetadata,
        inputMetadata,
        nodeAddress,
        this.#resource,
        gasLimit
      );
      const transactionHash = tx.hash;
      this.#doHash = transactionHash;

      this.#dispatchECEvent(`Waiting for transaction ${transactionHash} to be processed...`);
      const isProcessed = await this.#waitForTransactionToBeProcessed(this.#protocolContract, transactionHash);
      if (!isProcessed) {
        const reason = await this.#getReason(this.#protocolContract, transactionHash);
        this.#dispatchECEvent(`Unable to create DO request. ${reason}`);
        return false;
      }
      this.#dispatchECEvent(`Transaction ${transactionHash} was confirmed.`);

      return true;
    } catch (e) {
      console.log(e);
      if (e.message.search('cannot estimate gas; transaction may fail or may require manual gas limit') !== -1) {
        // eslint-disable-next-line no-return-await
        return this.#createDORequest(imageMetadata, codeMetadata, inputMetadata, nodeAddress, 5000000);
      }
      return false;
    }
  }

  // eslint-disable-next-line class-methods-use-this
  #parseOrderResult = (result) => {
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

  #parseTransactionBytes(bytes) {
    try {
      const result = parseTransactionBytes(this.#protocolAbi, bytes);
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

  async #getResultFromOrder(orderId) {
    try {
      // get the result of the order using the `etnyContract` object
      const orderResult = await this.#protocolContract.getResultFromOrder(orderId);
      this.#dispatchECEvent(`Task with order number ${orderId} was successfully processed at ${formatDate()}.`);

      // parse the order result
      const parsedOrderResult = this.#parseOrderResult(orderResult);
      this.#dispatchECEvent(`Result IPFS hash: ${parsedOrderResult.resultIPFSHash}`);
      // parse the transaction bytes of the order result
      const transactionResult = this.#parseTransactionBytes(parsedOrderResult.transactionBytes);

      // generate a wallet address using the `challengeHash` and `transactionResult.enclaveChallenge`
      const wallet = generateWallet(this.#challengeHash, transactionResult.enclaveChallenge);
      // check if the generated wallet address matches the `transactionResult.from` address
      if (!wallet || wallet !== transactionResult.from) {
        return { success: false, message: 'Integrity check failed, signer wallet address is wrong.' };
      }

      // get the result value from IPFS using the `parsedOrderResult.resultIPFSHash`
      const ipfsResult = await ipfsClient.getFromIPFS(parsedOrderResult.resultIPFSHash);
      // decrypt data
      const currentWalletAddress = this.#tokenContract.getCurrentWallet();
      const decryptedData = await decryptWithPrivateKey(ipfsResult, currentWalletAddress);

      if (!decryptedData.success) {
        return { success: false, message: 'Could not decrypt the order result.' };
      }

      // update the loading message to show the result value
      this.#dispatchECEvent(`Result value: ${decryptedData.data}`);
      // calculate the SHA-256 checksum of the result value
      const ipfsResultChecksum = sha256(decryptedData.data);
      // check if the calculated checksum matches the `transactionResult.checksum`
      if (ipfsResultChecksum !== transactionResult.checksum) {
        return { success: false, message: 'Integrity check failed, checksum of the order result is wrong.' };
      }

      // get the original input transaction hash and the output transaction hash for the order
      const transaction = await this.#protocolContract.getProvider().getTransaction(this.#doHash);
      const block = await this.#protocolContract.getProvider().getBlock(transaction.blockNumber);
      const blockTimestamp = block.timestamp;
      const endBlockNumber = await this.#protocolContract.getProvider().getBlockNumber();
      const startBlockNumber = endBlockNumber - LAST_BLOCKS;
      //
      let resultTransactionHash;
      let resultBlockTimestamp;

      // eslint-disable-next-line no-plusplus
      for (let i = endBlockNumber; i >= startBlockNumber; i--) {
        // eslint-disable-next-line no-await-in-loop
        const block = await this.#protocolContract.getProvider().getBlockWithTransactions(i);
        // eslint-disable-next-line no-continue
        if (!block || !block.transactions) continue;

        // eslint-disable-next-line no-restricted-syntax
        for (const transaction of block.transactions) {
          if (transaction.to === this.#protocolContract.contractAddress() && transaction.data) {
            resultTransactionHash = transaction.hash;
            resultBlockTimestamp = block.timestamp;
          }
        }
      }

      return {
        success: true,
        contractAddress: this.#tokenContract.contractAddress(),
        inputTransactionHash: this.#doHash,
        outputTransactionHash: resultTransactionHash,
        orderId,
        imageHash: `${this.#enclaveImageIPFSHash}:${this.#runnerType}`,
        scriptHash: this.#scriptHash,
        fileSetHash: this.#fileSetHash,
        publicTimestamp: blockTimestamp,
        resultHash: parsedOrderResult.resultIPFSHash,
        resultTaskCode: transactionResult.taskCodeString,
        resultValue: ipfsResult,
        resultTimestamp: resultBlockTimestamp,
        result: decryptedData.data
      };
    } catch (ex) {
      console.log(ex);
      if (ex.name === ECError.PARSE_ERROR) {
        return { success: false, message: 'Ethernity parsing transaction error.' };
      }
      if (ex.name === ECError.IPFS_DOWNLOAD_ERROR) {
        return { success: false, message: 'Ethernity IPFS download result error.' };
      }
      await delay(5000);
      this.#getResultFromOrderRepeats += 1;
      // eslint-disable-next-line no-return-await
      return await this.#getResultFromOrder(orderId);
    }
  }

  async #processTask(code) {
    await this.#listenForAddDORequestEvent();
    this.#challengeHash = generateRandomHexOfSize(20);
    // getting image metadata
    const imageMetadata = await this.#getV3ImageMetadata(this.#challengeHash);
    // // getting script metadata
    const codeMetadata = await this.#getV3CodeMetadata(code);
    // // getting input metadata
    const inputMetadata = await this.#getV3InputMedata();
    // // create new DO Request
    return this.#createDORequest(imageMetadata, codeMetadata, inputMetadata, this.#nodeAddress);
  }

  #reset = () => {
    this.#orderNumber = -1;
    this.#doHash = null;
    this.#doRequestId = -1;
    this.#doRequest = -1;
    this.#scriptHash = '';
    this.#fileSetHash = '';
    this.#interval = null;
    this.#getResultFromOrderRepeats = 1;
    this.#taskHasBeenPickedForApproval = false;
  };

  #cleanup = async () => {
    this.#reset();
    const contract = this.#protocolContract.getContract();
    contract.removeAllListeners();
  };

  #isNodeOperatorAddress = async (nodeAddress) => {
    if (isNullOrEmpty(nodeAddress)) return true;
    if (isAddress(nodeAddress)) {
      const isNode = await this.#protocolContract.isNodeOperator(nodeAddress);
      if (!isNode) {
        this.#dispatchECEvent('Introduced address is not a valid node operator address.', ECStatus.ERROR);
        return false;
      }
      return true;
    }
    this.#dispatchECEvent('Introduced address is not a valid wallet address.', ECStatus.ERROR);
    return false;
  };

  // eslint-disable-next-line class-methods-use-this
  initializeStorage(ipfsAddress, protocol, port, token) {
    ipfsClient.initialize(ipfsAddress, protocol, port, token);
  }

  // use this in order to reset the instance and have a new runner
  static resetInstance() {
    EthernityCloudRunner.instance = null;
  }

  async #checkNetwork() {
    try {
      // checking network
      const networkName = await this.#tokenContract.getNetworkName();
      console.log(networkName);
      // eslint-disable-next-line default-case
      switch (this.#networkAddress) {
        case ECAddress.BLOXBERG.MAINNET_ADDRESS:
        case ECAddress.BLOXBERG.TESTNET_ADDRESS:
          if (networkName !== ECNetworkName.BLOXBERG) {
            this.#dispatchECEvent(`Please switch Metamask network and use Bloxberg!`, ECStatus.ERROR);
          }
          break;
        case ECAddress.POLYGON.MAINNET_ADDRESS:
          if (networkName !== ECNetworkName.POLYGON) {
            this.#dispatchECEvent(`Please switch Metamask network and use Polygon!`, ECStatus.ERROR);
          }
          break;
        case ECAddress.POLYGON.TESTNET_ADDRESS:
          if (networkName !== ECNetworkName.MUMBAI) {
            this.#dispatchECEvent(`Please switch Metamask network and use Mumbai!`, ECStatus.ERROR);
          }
          break;
      }

      const runnerNetworkName = ECNetworkNameDictionary[this.#networkAddress];
      return networkName === runnerNetworkName;
    } catch (e) {
      this.#dispatchECEvent(
        `Please switch Metamask network and use ${ECNetworkName1Dictionary[this.#networkAddress]}!`,
        ECStatus.ERROR
      );
      return false;
    }
  }

  async run(
    runnerType,
    code,
    nodeAddress = '',
    resources = { taskPrice: 10, cpu: 1, memory: 1, storage: 40, bandwidth: 1, duration: 1, validators: 1 }
  ) {
    try {
      // checking if the balance of the wallet is higher or equal than the price we agreed to pay for task execution
      let balance = await this.#tokenContract.getBalance();
      balance = parseInt(balance, 10);
      if (balance < resources.taskPrice) {
        this.#dispatchECEvent(
          `Your wallet balance (${balance}/${resources.taskPrice}) is insufficient to cover the requested task price. The task has been declined.`,
          ECStatus.ERROR
        );
        return;
      }
      this.#nodeAddress = nodeAddress;
      this.#resource = resources;
      const isNodeOperatorAddress = await this.#isNodeOperatorAddress(nodeAddress);
      if (isNodeOperatorAddress) {
        this.#runnerType = runnerType;
        this.#imageRegistryContract = new ImageRegistryContract(this.#networkAddress, runnerType);
        await this.#cleanup();
        this.#dispatchECEvent('Started processing task...');

        await this.#tokenContract.initialize();

        const connected = await this.#handleMetaMaskConnection();
        if (connected) {
          await this.#getEnclaveDetails();
          // if (!this.#isMainnet) {
          //   const faucetResult = await this.#getTokensFromFaucet();
          //   if (!faucetResult) {
          //     this.#dispatchECEvent('Unable to retrieve tETNY from the faucet.', ECStatus.ERROR);
          //   }
          // }

          if (
            this.#networkAddress === ECAddress.POLYGON.MAINNET_ADDRESS ||
            this.#networkAddress === ECAddress.POLYGON.TESTNET_ADDRESS
          ) {
            this.#dispatchECEvent('Checking for the allowance on the current wallet...');
            const passedAllowance = await this.#tokenContract.checkAndSetAllowance(
              this.#protocolContract.contractAddress(),
              '100',
              resources.taskPrice.toString()
            );
            if (!passedAllowance) {
              this.#dispatchECEvent('Unable to set allowance.', ECStatus.ERROR);
              return;
            }
            this.#dispatchECEvent('Allowance checking completed.');
          }
          const canProcessTask = await this.#processTask(code);
          if (!canProcessTask) {
            this.#dispatchECEvent('Unable to proceed with the task; exiting.', ECStatus.ERROR);
          }
        } else {
          this.#dispatchECEvent('Unable to connect to MetaMask', ECStatus.ERROR);
        }
      }
    } catch (e) {
      this.#dispatchECEvent(e.message, ECStatus.ERROR);
    }
  }
}

export default EthernityCloudRunner;
