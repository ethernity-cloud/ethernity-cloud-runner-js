import { ethers } from 'ethers';
import contract from '../abi/etnyAbi';
import { sha256 } from '../../crypto';

class EtnyContract {
  etnyContract = null;

  etnyContactWithProvider = null;

  provider = null;

  signer = null;

  currentWallet = null;

  constructor(networkAddress) {
    this.provider = new ethers.providers.Web3Provider(window.ethereum);
    this.signer = this.provider.getSigner();
    this.etnyContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer);
    this.etnyContactWithProvider = new ethers.Contract(networkAddress || contract.address, contract.abi, this.provider);
  }

  async initialize() {
    this.currentWallet = await this._getCurrentWallet();
  }

  // eslint-disable-next-line class-methods-use-this
  contractAddress = () => contract.address;

  // eslint-disable-next-line class-methods-use-this
  isAddress = (address) => {
    try {
      ethers.utils.getAddress(address);
    } catch (e) {
      return false;
    }
    return true;
  };

  getSigner() {
    return this.signer;
  }

  getContract() {
    return this.etnyContract;
  }

  getProvider() {
    return this.provider;
  }

  getCurrentWallet() {
    return this.currentWallet;
  }

  async _getCurrentWallet() {
    try {
      const accounts = await this.provider.listAccounts();
      return accounts[0];
    } catch (e) {
      console.log(e);
      return null;
    }
  }

  async getBalance(account) {
    try {
      const balance = await this.etnyContract.balanceOf(account);
      // convert a currency unit from wei to ether
      return ethers.utils.formatEther(balance);
    } catch (ex) {
      return ex.message;
    }
  }

  async addDORequest(imageMetadata, payloadMetadata, inputMetadata, nodeAddress, resources) {
    const cpu = resources.cpu || 1;
    const memory = resources.memory || 1;
    const storage = resources.storage || 40;
    const bandwidth = resources.bandwidth || 1;
    const duration = resources.duration || 1;
    const validators = resources.validators || 1;
    const taskPrice = resources.taskPrice || 10;
    // eslint-disable-next-line no-underscore-dangle
    return this.etnyContract._addDORequest(
      cpu,
      memory,
      storage,
      bandwidth,
      duration,
      validators,
      taskPrice,
      imageMetadata,
      payloadMetadata,
      inputMetadata,
      nodeAddress
    );
  }

  async getOrdersCount() {
    return this.etnyContract._getOrdersCount();
  }

  async getOrder(orderId) {
    return this.etnyContract._getOrder(orderId);
  }

  async approveOrder(orderId) {
    return this.etnyContract._approveOrder(orderId);
  }

  async getResultFromOrder(orderId) {
    return this.etnyContract._getResultFromOrder(orderId);
  }

  async getFaucetTokens(account) {
    return this.etnyContract.faucet({ from: account });
  }

  async isNodeOperator(account) {
    try {
      const requests = await this.etnyContactWithProvider._getMyDPRequests({ from: account });
      return requests.length > 0;
    } catch (ex) {
      console.log(ex);
      return false;
    }
  }

  // eslint-disable-next-line class-methods-use-this
  parseTransactionBytes = (bytesInput) => {
    const parsedTransaction = ethers.utils.parseTransaction(bytesInput);
    const iface = new ethers.utils.Interface(contract.abi);
    const decodedData = iface.parseTransaction({ data: parsedTransaction.data, value: parsedTransaction.value });
    return {
      from: parsedTransaction.from,
      result: decodedData.args[1]
    };
  };

  // eslint-disable-next-line class-methods-use-this
  generateWallet = (clientChallenge, enclaveChallenge) => {
    try {
      const encoded = clientChallenge + enclaveChallenge;
      const hash = sha256(sha256(encoded, true), true);
      const wallet = new ethers.Wallet(`${hash}`);
      return wallet.address;
    } catch (e) {
      console.log(e);
      return false;
    }
  };

  async signMessage(message) {
    const signer = this.getSigner();
    return signer.signMessage(message);
  }
}

export default EtnyContract;
