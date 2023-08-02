import { ethers } from 'ethers';
import contract from '../abi/imageRegistryAbi';

class ImageRegistryContract {
  contract = null;

  ethereum = null;

  provider = null;

  signer = null;

  currentWallet = null;

  constructor() {
    this.ethereum = window.ethereum;
    this.provider = new ethers.providers.Web3Provider(window.ethereum);
    this.signer = this.provider.getSigner();
    this.contract = new ethers.Contract(contract.address, contract.abi, this.signer);
  }

  async initialize() {
    this.currentWallet = await this._getCurrentWallet();
  }

  getSigner() {
    return this.signer;
  }

  getContract() {
    return this.contract;
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
      return null;
    }
  }

  async getEnclaveDetailsV3(imageName, version) {
    try {
      return await this.contract.getLatestTrustedZoneImageCertPublicKey(imageName, version);
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}

export default ImageRegistryContract;
