import { ethers } from 'ethers';
import contract from '../abi/etnyAbi';

class BloxbergProtocolContract {
  etnyContract = null;

  etnyContactWithProvider = null;

  provider = null;

  signer = null;

  constructor(networkAddress) {
    this.provider = new ethers.providers.Web3Provider(window.ethereum);
    this.signer = this.provider.getSigner();
    this.etnyContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer);
    this.etnyContactWithProvider = new ethers.Contract(networkAddress || contract.address, contract.abi, this.provider);
  }

  // eslint-disable-next-line class-methods-use-this
  contractAddress = () => contract.address;

  getSigner() {
    return this.signer;
  }

  getContract() {
    return this.etnyContract;
  }

  getProvider() {
    return this.provider;
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

  async getOrder(orderId) {
    return this.etnyContract._getOrder(orderId);
  }

  async approveOrder(orderId) {
    return this.etnyContract._approveOrder(orderId);
  }

  async getResultFromOrder(orderId) {
    return this.etnyContract._getResultFromOrder(orderId);
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
  async signMessage(message) {
    const signer = this.getSigner();
    return signer.signMessage(message);
  }
}

export default BloxbergProtocolContract;
