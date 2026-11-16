import { ethers } from 'ethers';
import contract from '../abi/etnyAbi.js';
import { contractRunners } from '../../walletContext.js';
import { withGasHeadroom } from '../../utils.js';
import { requestTerms } from './requestTerms.js';

class BloxbergProtocolContract {
  etnyContract = null;

  etnyContactWithProvider = null;

  provider = null;

  signer = null;

  constructor(networkAddress, walletContext = null) {
    ({ provider: this.provider, signer: this.signer } = contractRunners(walletContext));
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
    const terms = requestTerms(resources);
    // eslint-disable-next-line no-underscore-dangle
    return withGasHeadroom(this.etnyContract._addDORequest, [
      terms.cpu,
      terms.memory,
      terms.storage,
      terms.bandwidth,
      terms.duration,
      terms.validators,
      terms.taskPrice,
      imageMetadata,
      payloadMetadata,
      inputMetadata,
      nodeAddress
    ]);
  }

  async getOrder(orderId) {
    return this.etnyContract._getOrder(orderId);
  }

  async approveOrder(orderId) {
    return this.etnyContract._approveOrder(orderId);
  }

  async cancelDORequest(doRequestId) {
    return withGasHeadroom(this.etnyContract._cancelDORequest, [doRequestId]);
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
