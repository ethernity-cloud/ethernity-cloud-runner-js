import { ethers } from 'ethers';
import contract from '../abi/etnyAbi.js';
import { ECNetworkByChainIdDictionary } from '../../enums.js';

class EtnyContract {
  etnyContract = null;

  etnyContactWithProvider = null;

  provider = null;

  signer = null;

  currentWallet = null;

  constructor(networkAddress, walletContext = null) {
    // Use the shared wallet context (raw key / injected signer / provider) when
    // provided; otherwise fall back to MetaMask via window.ethereum (unchanged).
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
    this.etnyContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer || this.provider);
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
      // Prefer the signer's own address: works for an ethers.Wallet (raw private
      // key), a JsonRpcSigner (window.ethereum), and injected signers alike.
      // provider.listAccounts() only returns an address for wallet-backed
      // providers (MetaMask) and is empty for a plain JsonRpcProvider (raw-key
      // path against a public RPC), so it can only be a fallback.
      if (this.signer && this.signer.getAddress) {
        const address = await this.signer.getAddress();
        if (address) return address;
      }
      const accounts = await this.provider.listAccounts();
      // ethers v6: listAccounts() returns signer objects
      return accounts[0] && (accounts[0].address || accounts[0]);
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
    // ethers v6: chainId is a bigint
    return ECNetworkByChainIdDictionary[Number(network.chainId)];
  }

  async signMessage(message) {
    const signer = this.getSigner();
    return signer.signMessage(message);
  }
}

export default EtnyContract;
