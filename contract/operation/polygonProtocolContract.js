import { ethers } from 'ethers';
import contract from '../abi/polygonProtocolAbi.js';
import { contractRunners } from '../../walletContext.js';
import { withGasHeadroom } from '../../utils.js';
import { requestTerms } from './requestTerms.js';

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
    ({ provider: this.provider, signer: this.signer } = contractRunners(walletContext));
    this.protocolContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer);
    this.protocolContractWithProvider = new ethers.Contract(networkAddress || contract.address, contract.abi, this.provider);
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
    const terms = requestTerms(resources);
    if (gasLimit) {
      return this.protocolContract._addDORequest(
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
        nodeAddress,
        { gasLimit }
      );
    }
    // eslint-disable-next-line no-underscore-dangle
    return withGasHeadroom(this.protocolContract._addDORequest, [
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

  // A DO request with V2 terms (PoX 1.2 addDORequestV2): the resources as
  // addDORequest sends them, one instance, and `terms` (runner.v2TermsOf):
  // maxPricePerCuHourWei, maxGflops, relaysPerHour and gasLevel. The
  // implementation pulls the escrow from the wallet's allowance in this call.
  async addDORequestV2(imageMetadata, payloadMetadata, inputMetadata, nodeAddress, resources, terms) {
    console.log('adding new DO Request (V2 terms)');
    const {
      cpu, memory, storage, bandwidth, duration
    } = requestTerms(resources);
    return withGasHeadroom(this.protocolContract.addDORequestV2, [
      cpu,
      memory,
      storage,
      bandwidth,
      duration,
      1,
      terms.maxPricePerCuHourWei,
      terms.maxGflops,
      terms.relaysPerHour,
      terms.gasLevel,
      imageMetadata,
      payloadMetadata,
      inputMetadata,
      nodeAddress
    ]);
  }

  async getOrder(orderId) {
    return this.protocolContract._getOrder(orderId);
  }

  async approveOrder(orderId) {
    return this.protocolContract._approveOrder(orderId);
  }

  async cancelDORequest(doRequestId) {
    return withGasHeadroom(this.protocolContract._cancelDORequest, [doRequestId]);
  }

  async getResultFromOrder(orderId) {
    return this.protocolContract._getResultFromOrder(orderId);
  }

  async getFaucetTokens(account) {
    return this.protocolContract.faucet({ from: account });
  }

  // Whether `account` holds a DP request on this PoX. A read the contract or
  // the RPC refuses is thrown: it says nothing about the account.
  async isNodeOperator(account) {
    const requests = await this.protocolContractWithProvider._getMyDPRequests({ from: account });
    return requests.length > 0;
  }

  // { storage, admitted }: the EthernityCloudStorage this implementation
  // names (ethStorageAddress) and whether that storage lists the
  // implementation among its allowed callers; null when either read fails.
  // The storage refuses every call, reads included, made through an
  // implementation it does not list ("Allowed caller: caller is not
  // allowed"), which is the state of an implementation a later one replaced.
  async storageAdmission() {
    try {
      const storage = await this.protocolContractWithProvider.ethStorageAddress();
      const allowList = new ethers.Contract(storage, ['function allowedCallers(address) view returns (bool)'], this.provider);
      const admitted = await allowList.allowedCallers(await this.protocolContractWithProvider.getAddress());
      return { storage, admitted };
    } catch (ex) {
      return null;
    }
  }

  async signMessage(message) {
    const signer = this.getSigner();
    return signer.signMessage(message);
  }
}

export default PolygonProtocolContract;
