import { ethers } from 'ethers';
import contract from '../abi/ecldAbi';
import { ECNetworkByChainIdDictionary } from '../../enums';

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

  async getNetworkName() {
    // Get the network information
    const network = await this.provider.getNetwork();

    // Access the network name
    const networkName = network.name;
    console.log('Current network:', networkName);

    return ECNetworkByChainIdDictionary[network.chainId];
  }

  // Fetch the current allowance and update if needed
  // approval address should be the address of protocol contract
  async checkAndSetAllowance(protocolAddress, amount, taskPrice) {
    const allowanceAmount = ethers.utils.parseUnits(amount, 'ether'); // Adjust the amount accordingly
    const taskPriceAmount = ethers.utils.parseUnits(taskPrice, 'ether');
    const currentWalletAddress = await this.signer.getAddress();
    const allowance = await this.ecldContract.allowance(currentWalletAddress, protocolAddress);
    console.log(`initial allowance: ${allowance}`);
    // check if the current allowance is lower than allowanceAmount or taskPriceAmount
    // in this case we should add more tokens
    if (allowance.lt(taskPriceAmount)) {
      const approveTx = await this.ecldContract.approve(protocolAddress, allowanceAmount);
      try {
        await approveTx.wait();
        console.log(`Transaction mined successfully: ${approveTx.hash}`);
        const allowance = await this.ecldContract.allowance(currentWalletAddress, protocolAddress);
        console.log(`after approval allowance:${allowance}`);
      } catch (error) {
        console.log(`Transaction failed with error: ${error}`);
        return false;
      }
    }

    return true;
  }

  async approve(tokens) {
    const allowanceAmount = ethers.utils.parseUnits(tokens, 'ether'); // Adjust the amount accordingly
    const address = await this.signer.getAddress();
    return this.ecldContract.approve(address, allowanceAmount);
  }

  async getBalance() {
    try {
      const address = await this.signer.getAddress();
      const balance = await this.ecldContract.balanceOf(address);
      // convert a currency unit from wei to ether
      return ethers.utils.formatEther(balance);
    } catch (ex) {
      console.log(ex);
      return 0;
    }
  }

  async signMessage(message) {
    const signer = this.getSigner();
    return signer.signMessage(message);
  }
}

export default EcldContract;
