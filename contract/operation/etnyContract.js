import { ethers } from 'ethers';
import contract from '../abi/etnyAbi.js';
import { ECNetworkByChainIdDictionary } from '../../enums.js';
import { contractRunners } from '../../walletContext.js';

class EtnyContract {
  etnyContract = null;

  etnyContactWithProvider = null;

  provider = null;

  signer = null;

  currentWallet = null;

  constructor(networkAddress, walletContext = null) {
    // Use the shared wallet context (raw key / injected signer / provider) when
    // provided; otherwise fall back to MetaMask via window.ethereum (unchanged).
    ({ provider: this.provider, signer: this.signer } = contractRunners(walletContext));
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
      // The signer's own address: an ethers.Wallet (raw private key), a
      // browser wallet's account, or an injected signer.
      return this.signer ? await this.signer.getAddress() : null;
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
      return ethers.formatEther(balance);
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
