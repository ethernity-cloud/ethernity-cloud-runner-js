import { ethers } from 'ethers';
import contract from '../abi/ecldAbi';

class EcldContract {
  ecldContract = null;

  ecldContactWithProvider = null;

  provider = null;

  signer = null;

  currentWallet = null;

  constructor(networkAddress) {
    this.provider = new ethers.providers.Web3Provider(window.ethereum);
    this.signer = this.provider.getSigner();
    this.ecldContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer);
    this.ecldContactWithProvider = new ethers.Contract(networkAddress || contract.address, contract.abi, this.provider);
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
    return this.ecldContract;
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
      const balance = await this.ecldContract.balanceOf(account);
      // convert a currency unit from wei to ether
      return ethers.utils.formatEther(balance);
    } catch (ex) {
      return ex.message;
    }
  }

  async signMessage(message) {
    const signer = this.getSigner();
    return signer.signMessage(message);
  }
}

export default EcldContract;
