import { ethers } from 'ethers';
import contract from '../abi/imageRegistryAbi';
import { ECAddress } from '../../enums';

class ImageRegistryContract {
  contract = null;

  ethereum = null;

  provider = null;

  signer = null;

  constructor(networkAddress = ECAddress.BLOXBERG_TESTNET_ADDRESS) {
    this.ethereum = window.ethereum;
    this.provider = new ethers.providers.Web3Provider(window.ethereum);
    this.signer = this.provider.getSigner();
    switch (networkAddress) {
      case ECAddress.BLOXBERG_TESTNET_ADDRESS:
      case ECAddress.BLOXBERG_MAINNET_ADDRESS:
        this.contract = new ethers.Contract(contract.address_bloxberg, contract.abi, this.signer);
        break;
      case ECAddress.POLYGON_MAINNET_ADDRESS:
      case ECAddress.POLYGON_TESTNET_ADDRESS:
        this.contract = new ethers.Contract(contract.address_polygon, contract.abi, this.signer);
        break;
      default:
    }
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
