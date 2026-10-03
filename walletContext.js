import { Buffer } from 'buffer';
import { ethers } from 'ethers';
import { getEncryptionPublicKey } from '@metamask/eth-sig-util';
import { ECAddress } from './enums.js';

// Default RPC endpoints, keyed by the network's protocol-contract address. Used
// only for the raw-privateKey convenience path, where we must bind the wallet
// to the correct chain instead of inheriting whatever chain window.ethereum /
// an embedded wallet (Web3Auth, etc.) happens to be on.
const DEFAULT_RPC_BY_ADDRESS = {
  [ECAddress.BLOXBERG.TESTNET_ADDRESS]: 'https://bloxberg.ethernity.cloud',
  [ECAddress.BLOXBERG.MAINNET_ADDRESS]: 'https://bloxberg.ethernity.cloud',
  [ECAddress.POLYGON.MAINNET_ADDRESS]: 'https://polygon-rpc.com',
  [ECAddress.POLYGON.TESTNET_ADDRESS]: 'https://rpc-amoy.polygon.technology'
  // NOTE: IoTeX / Sepolia / LitVM testnets share one ECLD token address, so they
  // cannot be keyed here by networkAddress. For the raw-privateKey path on those
  // networks, pass an explicit { rpcUrl } (or { provider }) in walletOptions:
  //   IoTeX   : https://babel-api.testnet.iotex.io
  //   Sepolia : https://ethereum-sepolia-rpc.publicnode.com
  //   LitVM   : https://liteforge.rpc.caldera.xyz/infra-partner-http
};

/**
 * The signer of a wallet provider (window.ethereum, or a provider passed in)
 * whose account is known only once the wallet answers: ethers 6 hands it out
 * through the async provider.getSigner(), while the runner and its contracts
 * are built synchronously. This signer asks for the account on first use and
 * passes every call to it; a refused request is asked again on the next use.
 */
export class ProviderAccountSigner extends ethers.AbstractSigner {
  constructor(provider) {
    super(provider);
    this.account = null;
  }

  resolveAccount() {
    if (!this.account) {
      this.account = this.provider.getSigner().catch((e) => {
        this.account = null;
        throw e;
      });
    }
    return this.account;
  }

  connect(provider) {
    return new ProviderAccountSigner(provider);
  }

  async getAddress() {
    return (await this.resolveAccount()).getAddress();
  }

  async signTransaction(tx) {
    return (await this.resolveAccount()).signTransaction(tx);
  }

  async sendTransaction(tx) {
    return (await this.resolveAccount()).sendTransaction(tx);
  }

  async signMessage(message) {
    return (await this.resolveAccount()).signMessage(message);
  }

  async signTypedData(domain, types, value) {
    return (await this.resolveAccount()).signTypedData(domain, types, value);
  }
}

/**
 * The provider and signer a contract uses: the wallet context's, else the
 * browser wallet's (window.ethereum). signer is null for a provider that
 * holds no account.
 */
export function contractRunners(walletContext) {
  if (walletContext && walletContext.provider) {
    const { provider } = walletContext;
    return {
      provider,
      signer: walletContext.signer || (provider.getSigner ? new ProviderAccountSigner(provider) : null)
    };
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  return { provider, signer: new ProviderAccountSigner(provider) };
}

/**
 * Resolve the wallet options passed to EthernityCloudRunner into a single,
 * chain-correct context that the runner and every contract share.
 *
 * Accepts (all optional):
 *   privateKey            - '0x...' raw key; builds an ethers.Wallet on the
 *                           network's own RPC (or opts.rpcUrl / opts.provider).
 *   signer                - a pre-built ethers Signer (WalletConnect/Privy/...).
 *   provider              - a pre-built ethers Provider.
 *   rpcUrl                - override RPC for the privateKey path.
 *   encryptionPublicKey   - X25519 pubkey as a HEX string (the format embedded
 *                           into task metadata); skips deriving it and the
 *                           MetaMask eth_getEncryptionPublicKey call.
 *
 * When NO opts are given, falls back to window.ethereum (MetaMask) exactly as
 * before, so existing consumers are unaffected.
 *
 * Returns { provider, signer, privateKey, encryptionPublicKey, usesWindowEthereum }.
 */
export function resolveWalletContext(networkAddress, opts = {}) {
  const { privateKey, signer, provider, rpcUrl, encryptionPublicKey } = opts;

  // 1) raw private key -> ethers.Wallet bound to the correct chain
  if (privateKey) {
    const rpc =
      rpcUrl || DEFAULT_RPC_BY_ADDRESS[networkAddress] || DEFAULT_RPC_BY_ADDRESS[ECAddress.BLOXBERG.TESTNET_ADDRESS];
    // polling: contract events are read with eth_getLogs, which any backend
    // behind a load-balanced RPC answers, rather than through an eth_newFilter
    // id that only the backend which created it knows.
    const rpcProvider = provider || new ethers.JsonRpcProvider(rpc, undefined, { polling: true });
    const wallet = new ethers.Wallet(privateKey, rpcProvider);
    return {
      provider: rpcProvider,
      signer: wallet,
      privateKey,
      encryptionPublicKey: encryptionPublicKey || deriveEncryptionPublicKey(privateKey),
      usesWindowEthereum: false
    };
  }

  // 2) caller-supplied signer and/or provider (WalletConnect, Privy, Web3Auth EIP-1193, ...)
  if (signer || provider) {
    const resolvedProvider = provider || (signer && signer.provider) || null;
    return {
      provider: resolvedProvider,
      signer: signer || (resolvedProvider && resolvedProvider.getSigner ? new ProviderAccountSigner(resolvedProvider) : null),
      privateKey: null,
      encryptionPublicKey: encryptionPublicKey || null,
      usesWindowEthereum: false
    };
  }

  // 3) default: MetaMask via window.ethereum (unchanged legacy behaviour)
  if (typeof window !== 'undefined' && window.ethereum) {
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    return {
      provider: browserProvider,
      signer: new ProviderAccountSigner(browserProvider),
      privateKey: null,
      encryptionPublicKey: encryptionPublicKey || null,
      usesWindowEthereum: true
    };
  }

  throw new Error(
    'No wallet available: pass { privateKey } or { signer } / { provider } to EthernityCloudRunner, or provide window.ethereum (MetaMask).'
  );
}

/**
 * Derive the X25519 encryption public key from a raw Ethereum private key,
 * using MetaMask's exact reference implementation (@metamask/eth-sig-util), so
 * it matches what eth_getEncryptionPublicKey would return for the same key and
 * stays interoperable with tasks encrypted the MetaMask way. Returns a hex
 * string (the format the runner embeds into task metadata).
 */
export function deriveEncryptionPublicKey(privateKey) {
  const pkHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
  const keyB64 = getEncryptionPublicKey(pkHex); // base64, same as eth_getEncryptionPublicKey
  return Buffer.from(keyB64, 'base64').toString('hex');
}
