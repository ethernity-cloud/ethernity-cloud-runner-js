import { ethers } from 'ethers';
import contract from '../abi/ecldAbi.js';
import { ECNetworkByChainIdDictionary } from '../../enums.js';

class EcldContract {
  ecldContract = null;

  ecldContactWithProvider = null;

  provider = null;

  signer = null;

  currentWallet = null;

  constructor(networkAddress, walletContext = null) {
    // ethers v6: the signer is pre-resolved by resolveWalletContext (getSigner()
    // is async in v6 and cannot run in this sync constructor). walletContext
    // always carries a resolved signer; fall back to a BrowserProvider only for
    // the legacy no-context path, where the contract is used read-only until a
    // signer is attached.
    if (walletContext && walletContext.provider) {
      this.provider = walletContext.provider;
      this.signer = walletContext.signer || null;
    } else {
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = null;
    }
    this.ecldContract = new ethers.Contract(networkAddress || contract.address, contract.abi, this.signer || this.provider);
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
      // Prefer the signer's own address: works for an ethers.Wallet (raw private
      // key), a JsonRpcSigner (window.ethereum), and injected signers alike.
      // provider.listAccounts() is empty for a plain JsonRpcProvider (raw-key
      // path against a public RPC), so it can only be a fallback.
      if (this.signer && this.signer.getAddress) {
        const address = await this.signer.getAddress();
        if (address) return address;
      }
      // ethers v6: listAccounts() returns JsonRpcSigner objects, not address
      // strings; read .address off the first one.
      const accounts = await this.provider.listAccounts();
      return accounts[0] && (accounts[0].address || accounts[0]);
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

    // ethers v6: chainId is a bigint; coerce to Number for the dictionary lookup.
    return ECNetworkByChainIdDictionary[Number(network.chainId)];
  }

  // Fetch the current allowance and update if needed
  // approval address should be the address of protocol contract
  async checkAndSetAllowance(protocolAddress, amount, taskPrice) {
    const allowanceAmount = ethers.parseUnits(amount, 'ether'); // Adjust the amount accordingly
    const taskPriceAmount = ethers.parseUnits(taskPrice, 'ether');
    const currentWalletAddress = await this.signer.getAddress();
    const allowance = await this.ecldContract.allowance(currentWalletAddress, protocolAddress);
    console.log(`initial allowance: ${allowance}`);
    // check if the current allowance is lower than allowanceAmount or taskPriceAmount
    // in this case we should add more tokens.
    // ethers v6: allowance is a bigint -> use < instead of BigNumber.lt().
    if (allowance < taskPriceAmount) {
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
