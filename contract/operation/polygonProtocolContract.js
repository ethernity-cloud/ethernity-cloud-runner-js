import { ethers } from 'ethers';
import contract from '../abi/polygonProtocolAbi.js';

// process.env is undefined in non-React browser bundles; guard so the module
// loads there and the gas params fall back to their defaults.
const env = typeof process !== 'undefined' && process.env ? process.env : {};

class PolygonProtocolContract {
  networkAddress = null;

  protocolContract = null;

  protocolContractWithProvider = null;

  provider = null;

  signer = null;

  constructor(networkAddress, walletContext = null) {
    console.log('Polygon protocol address: ', networkAddress);
    this.networkAddress = networkAddress;
    // ethers v6: the signer is pre-resolved by resolveWalletContext (getSigner()
    // is async in v6). walletContext always carries a resolved signer; fall back
    // to a BrowserProvider only for the legacy no-context path.
    if (walletContext && walletContext.provider) {
      this.provider = walletContext.provider;
      this.signer = walletContext.signer || null;
    } else {
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = null;
    }
    this.protocolContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer || this.provider);
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
    // Default to 30 gwei when the env override is absent; parseInt(undefined)
    // would otherwise yield NaN and produce an invalid fee.
    const maxFeePerGas = parseInt(env.REACT_APP_MAX_FEE_PER_GAS || '30', 10) * 10 ** 9;
    const maxPriorityFeePerGas = parseInt(env.REACT_APP_MAX_PRIORITY_FEE_PER_GAS || '30', 10) * 10 ** 9;

    const options = {
      gasLimit: parseInt(env.REACT_APP_GAS_LIMIT, 10) || 200000,
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
