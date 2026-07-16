import { ethers } from 'ethers';
import contract from '../abi/imageRegistryAbi.js';
import { ECAddress, ECRunner } from '../../enums.js';

class ImageRegistryContract {
  contract = null;

  ethereum = null;

  provider = null;

  signer = null;

  constructor(
    networkAddress = ECAddress.BLOXBERG.TESTNET_ADDRESS,
    runnerType = ECRunner.BLOXBERG.NODENITHY_RUNNER,
    walletContext = null,
    registryAddress = undefined
  ) {
    // ethers v6: the signer is pre-resolved by resolveWalletContext (getSigner()
    // is async in v6). walletContext always carries a resolved signer; fall back
    // to a BrowserProvider only for the legacy no-context path.
    if (walletContext && walletContext.provider) {
      this.ethereum = null;
      this.provider = walletContext.provider;
      this.signer = walletContext.signer || null;
    } else {
      this.ethereum = window.ethereum;
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = null;
    }

    // When the caller resolved the Image Registry address from the network
    // descriptor (all networks beyond the legacy Bloxberg/Polygon pair), use it
    // directly and skip the 2-network switch below.
    if (registryAddress) {
      this.contract = new ethers.Contract(registryAddress, contract.abi, this.signer || this.provider);
      return;
    }

    switch (networkAddress) {
      case ECAddress.BLOXBERG.TESTNET_ADDRESS:
        if (runnerType === ECRunner.BLOXBERG.NODENITHY_RUNNER_TESTNET) {
          this.contract = new ethers.Contract(
            ECAddress.BLOXBERG.IMAGE_REGISTRY.NODENITHY.TESTNET_ADDRESS,
            contract.abi,
            this.signer || this.provider
          );
        }

        if (runnerType === ECRunner.BLOXBERG.PYNITHY_RUNNER_TESTNET) {
          this.contract = new ethers.Contract(
            ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
            contract.abi,
            this.signer || this.provider
          );
        }
        break;
      case ECAddress.BLOXBERG.MAINNET_ADDRESS:
        if (runnerType === ECRunner.BLOXBERG.NODENITHY_RUNNER) {
          this.contract = new ethers.Contract(
            ECAddress.BLOXBERG.IMAGE_REGISTRY.NODENITHY.MAINNET_ADDRESS,
            contract.abi,
            this.signer || this.provider
          );
        }

        if (runnerType === ECRunner.BLOXBERG.PYNITHY_RUNNER) {
          this.contract = new ethers.Contract(
            ECAddress.BLOXBERG.IMAGE_REGISTRY.PYNITHY.MAINNET_ADDRESS,
            contract.abi,
            this.signer || this.provider
          );
        }
        break;
      case ECAddress.POLYGON.MAINNET_ADDRESS:
        if (runnerType === ECRunner.POLYGON.NODENITHY_RUNNER) {
          this.contract = new ethers.Contract(
            ECAddress.POLYGON.IMAGE_REGISTRY.NODENITHY.MAINNET_ADDRESS,
            contract.abi,
            this.signer || this.provider
          );
        }

        if (runnerType === ECRunner.POLYGON.PYNITHY_RUNNER) {
          this.contract = new ethers.Contract(
            ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.MAINNET_ADDRESS,
            contract.abi,
            this.signer || this.provider
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
            this.signer || this.provider
          );
        }

        if (runnerType === ECRunner.POLYGON.PYNITHY_RUNNER_TESTNET) {
          console.log('POLYGON.PYNITHY_RUNNER_TESTNET');
          this.contract = new ethers.Contract(
            ECAddress.POLYGON.IMAGE_REGISTRY.PYNITHY.TESTNET_ADDRESS,
            contract.abi,
            this.signer || this.provider
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

  async getEnclaveDetailsV3(imageName, version, trustedZoneImage = 'etny-pynithy-testnet') {
      try {
        const trustedZonePublicKey = (await this.contract.getLatestTrustedZoneImageCertPublicKey(trustedZoneImage, 'v3'));
        const imageDetails = await this.contract.getLatestImageVersionPublicKey(imageName, 'v3');
        return [imageDetails[0], trustedZonePublicKey[1], imageDetails[2]];
      } catch (e) {
        console.log(e);
        return null;
      }
    }
}

export default ImageRegistryContract;
