import { ethers } from 'ethers';
import contract from '../abi/imageRegistryAbi';
import { ECAddress, ECRunner } from '../../enums';

class ImageRegistryContract {
  contract = null;

  ethereum = null;

  provider = null;

  signer = null;

  constructor(networkAddress = ECAddress.BLOXBERG.TESTNET_ADDRESS, runnerType = ECRunner.BLOXBERG.NODENITHY_RUNNER) {
    this.ethereum = window.ethereum;
    this.provider = new ethers.providers.Web3Provider(window.ethereum);
    this.signer = this.provider.getSigner();
    console.log('Token address: ', networkAddress);
    switch (networkAddress) {
      case ECAddress.BLOXBERG.TESTNET_ADDRESS:
        if (runnerType === ECRunner.BLOXBERG.NODENITHY_RUNNER_TESTNET) {
          this.contract = new ethers.Contract(
            ECAddress.BLOXBERG.IMAGE_REGISTRY.NODENITHY.TESTNET_ADDRESS,
            contract.abi,
            this.signer
          );
        }

        if (runnerType === ECRunner.BLOXBERG.PYNITHY_RUNNER_TESTNET) {
          this.contract = new ethers.Contract(
            ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
            contract.abi,
            this.signer
          );
        }
        break;
      case ECAddress.BLOXBERG.MAINNET_ADDRESS:
        if (runnerType === ECRunner.BLOXBERG.NODENITHY_RUNNER) {
          this.contract = new ethers.Contract(
            ECAddress.BLOXBERG.IMAGE_REGISTRY.NODENITHY.MAINNET_ADDRESS,
            contract.abi,
            this.signer
          );
        }

        if (runnerType === ECRunner.BLOXBERG.PYNITHY_RUNNER) {
          this.contract = new ethers.Contract(
            ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.MAINNET_ADDRESS,
            contract.abi,
            this.signer
          );
        }
        break;
      case ECAddress.POLYGON.MAINNET_ADDRESS:
        if (runnerType === ECRunner.POLYGON.NODENITHY_RUNNER) {
          this.contract = new ethers.Contract(
            ECAddress.POLYGON.IMAGE_REGISTRY.NODENITHY.MAINNET_ADDRESS,
            contract.abi,
            this.signer
          );
        }

        if (runnerType === ECRunner.POLYGON.PYNITHY_RUNNER) {
          this.contract = new ethers.Contract(
            ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.MAINNET_ADDRESS,
            contract.abi,
            this.signer
          );
        }
        break;
      case ECAddress.POLYGON.TESTNET_ADDRESS:
        console.log('POLYGON.TESTNET_ADDRESS');
        if (runnerType === ECRunner.POLYGON.NODENITHY_RUNNER_TESTNET) {
          console.log('POLYGON.NODENITHY_RUNNER_TESTNET');
          this.contract = new ethers.Contract(
            ECAddress.POLYGON.IMAGE_REGISTRY.NODENITHY.TESTNET_ADDRESS,
            contract.abi,
            this.signer
          );
        }

        if (runnerType === ECRunner.POLYGON.PYNITHY_RUNNER_TESTNET) {
          console.log('POLYGON.PYNITHY_RUNNER_TESTNET');
          this.contract = new ethers.Contract(
            ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
            contract.abi,
            this.signer
          );
        }
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
