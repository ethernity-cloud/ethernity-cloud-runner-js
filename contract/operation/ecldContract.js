import { ethers } from 'ethers';
import contract from '../abi/ecldAbi.js';
import { ECNetworkByChainIdDictionary } from '../../enums.js';
import { contractRunners } from '../../walletContext.js';
import { checkAndSetAllowance } from './tokenAllowance.js';

class EcldContract {
  ecldContract = null;

  ecldContactWithProvider = null;

  provider = null;

  signer = null;

  currentWallet = null;

  constructor(networkAddress, walletContext = null) {
    ({ provider: this.provider, signer: this.signer } = contractRunners(walletContext));
    this.ecldContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer);
    this.ecldContactWithProvider = new ethers.Contract(networkAddress || contract.address, contract.abi, this.provider);
  }

  async initialize() {
    this.currentWallet = await this._getCurrentWallet();
  }

  // The address of the token contract this instance is bound to.
  contractAddress = () => this.ecldContract.target;

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
      // The signer's own address: an ethers.Wallet (raw private key), a
      // browser wallet's account, or an injected signer.
      return this.signer ? await this.signer.getAddress() : null;
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

  // The wallet's allowance for the PoX at `protocolAddress` on the token,
  // raised to `escrow` tokens when it is below it, by the one implementation
  // every token contract shares (tokenAllowance.js).
  async checkAndSetAllowance(protocolAddress, escrow, report) {
    return checkAndSetAllowance(this.getContract(), this.signer, protocolAddress, escrow, report);
  }

  async approve(tokens) {
    const allowanceAmount = ethers.parseUnits(tokens, 'ether'); // Adjust the amount accordingly
    const address = await this.signer.getAddress();
    return this.ecldContract.approve(address, allowanceAmount);
  }

  async getBalance() {
    try {
      const address = await this.signer.getAddress();
      const balance = await this.ecldContract.balanceOf(address);
      // convert a currency unit from wei to ether
      return ethers.formatEther(balance);
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
