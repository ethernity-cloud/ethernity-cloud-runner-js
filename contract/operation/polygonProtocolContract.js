import { ethers } from 'ethers';
import contract from '../abi/polygonProtocolAbi';

class PolygonProtocolContract {
  networkAddress = null;

  protocolContract = null;

  protocolContractWithProvider = null;

  provider = null;

  signer = null;

  constructor(networkAddress) {
    console.log('Polygon protocol address: ', networkAddress);
    this.networkAddress = networkAddress;
    this.provider = new ethers.providers.Web3Provider(window.ethereum);
    this.signer = this.provider.getSigner();
    this.protocolContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer);
    this.protocolContractWithProvider = new ethers.Contract(contract.address, contract.abi, this.provider);
  }

  // eslint-disable-next-line class-methods-use-this
  contractAddress = () => this.networkAddress;

  // eslint-disable-next-line class-methods-use-this

  getSigner() {
    return this.signer;
  }

  getContract() {
    return this.protocolContract;
  }

  getProvider() {
    return this.provider;
  }

  // eslint-disable-next-line class-methods-use-this
  getEIP1559GasOptions() {
    // const limit = 250 * 10 ** 9;
    const maxFeePerGas = parseInt(process.env.REACT_APP_MAX_FEE_PER_GAS, 10) * 10 ** 9;
    const maxPriorityFeePerGas = parseInt(process.env.REACT_APP_MAX_PRIORITY_FEE_PER_GAS, 10) * 10 ** 9;

    const options = {
      gasLimit: parseInt(process.env.REACT_APP_GAS_LIMIT, 10) || 200000,
      maxFeePerGas,
      maxPriorityFeePerGas
    };
    console.log(options);
    return options;
  }

  async addDORequest(imageMetadata, payloadMetadata, inputMetadata, nodeAddress, resources, gasLimit) {
    console.log('adding new DO Request');
    const cpu = resources.cpu || 1;
    const memory = resources.memory || 1;
    const storage = resources.storage || 40;
    const bandwidth = resources.bandwidth || 1;
    const duration = resources.duration || 1;
    const validators = resources.validators || 1;
    const taskPrice = resources.taskPrice || 10;
    if (gasLimit) {
      return this.protocolContract._addDORequest(
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
        nodeAddress,
        { gasLimit }
      );
    }
    // eslint-disable-next-line no-underscore-dangle
    return this.protocolContract._addDORequest(
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
      // this.getEIP1559GasOptions()
    );
  }

  async getOrder(orderId) {
    return this.protocolContract._getOrder(orderId);
  }

  async approveOrder(orderId) {
    return this.protocolContract._approveOrder(orderId);
  }

  async getResultFromOrder(orderId) {
    return this.protocolContract._getResultFromOrder(orderId);
  }

  async getFaucetTokens(account) {
    return this.protocolContract.faucet({ from: account });
  }

  async isNodeOperator(account) {
    try {
      const requests = await this.protocolContractWithProvider._getMyDPRequests({ from: account });
      return requests.length > 0;
    } catch (ex) {
      console.log(ex);
      return false;
    }
  }

  async signMessage(message) {
    const signer = this.getSigner();
    return signer.signMessage(message);
  }
}

export default PolygonProtocolContract;
