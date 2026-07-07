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
    const rpcProvider = provider || new ethers.providers.JsonRpcProvider(rpc);
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
      signer: signer || (resolvedProvider && resolvedProvider.getSigner && resolvedProvider.getSigner()) || null,
      privateKey: null,
      encryptionPublicKey: encryptionPublicKey || null,
      usesWindowEthereum: false
    };
  }

  // 3) default: MetaMask via window.ethereum (unchanged legacy behaviour)
  if (typeof window !== 'undefined' && window.ethereum) {
    const web3Provider = new ethers.providers.Web3Provider(window.ethereum);
    return {
      provider: web3Provider,
      signer: web3Provider.getSigner(),
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
