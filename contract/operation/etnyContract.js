import { ethers } from 'ethers';
import contract from '../abi/etnyAbi';
import { ECNetworkByChainIdDictionary } from '../../enums';

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

  async getBalance() {
    try {
      const address = await this.signer.getAddress();
      const balance = await this.etnyContract.balanceOf(address);
      // convert a currency unit from wei to ether
      return ethers.utils.formatEther(balance);
    } catch (ex) {
      console.log(ex);
      return 0;
    }
  }

  async getNetworkName() {
    // Connect to an Ethereum provider

    // Get the network information
    const network = await this.provider.getNetwork();

    // Access the network name
    const networkName = network.name;

    console.log('Current network:', networkName);
    return ECNetworkByChainIdDictionary[network.chainId];
  }

  async signMessage(message) {
    const signer = this.getSigner();
    return signer.signMessage(message);
  }
}

export default EtnyContract;
