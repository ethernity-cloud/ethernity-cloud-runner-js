import { ethers } from 'ethers';
import contract from '../abi/etnyAbi.js';
import { ECNetworkByChainIdDictionary } from '../../enums.js';
import { contractRunners } from '../../walletContext.js';
import { checkAndSetAllowance } from './tokenAllowance.js';
import { readTokenBalance } from './tokenBalance.js';

class EtnyContract {
  etnyContract = null;

  etnyContactWithProvider = null;

  provider = null;

  signer = null;

  currentWallet = null;

  // The token's name in the messages of this instance: the network
  // descriptor's tokenName (tETNY, ETNY), 'token' when built without one.
  tokenName = 'token';

  constructor(networkAddress, walletContext = null, tokenName = 'token') {
    // Use the shared wallet context (raw key / injected signer / provider) when
    // provided; otherwise fall back to MetaMask via window.ethereum (unchanged).
    ({ provider: this.provider, signer: this.signer } = contractRunners(walletContext));
    this.etnyContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer);
    this.etnyContactWithProvider = new ethers.Contract(networkAddress || contract.address, contract.abi, this.provider);
    this.tokenName = tokenName;
  }

  async initialize() {
    this.currentWallet = await this._getCurrentWallet();
  }

  // The address of the token contract this instance is bound to.
  contractAddress = () => this.etnyContract.target;

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

  // The balance of `wallet`, the signer's address when not given, on the
  // token, in tokens (tokenBalance.readTokenBalance): a read the provider
  // fails throws the error naming the cause.
  async getBalance(wallet = null) {
    return readTokenBalance(this.etnyContract, wallet ?? (await this.signer.getAddress()), this.tokenName);
  }

  // The wallet's allowance for the PoX at `protocolAddress` on the token,
  // raised to `escrow` tokens when it is below it, by the one implementation
  // every token contract shares (tokenAllowance.js).
  async checkAndSetAllowance(protocolAddress, escrow, report) {
    return checkAndSetAllowance(this.getContract(), this.signer, protocolAddress, escrow, report);
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
