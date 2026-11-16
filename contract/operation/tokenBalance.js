import { ethers } from 'ethers';
import { providerMessage } from '../../utils.js';

// The balance of `wallet` on `token`, the ERC-20 ethers contract, in tokens
// (a decimal string). The one implementation of the read, called by
// EtnyContract and EcldContract alike. A read the provider fails throws an
// Error naming the token (`tokenName`), the wallet, the token's address and
// the provider's message (utils.providerMessage), with the provider's error
// as its cause; it never answers a balance of 0 for one.
export async function readTokenBalance(token, wallet, tokenName) {
  let balance;
  try {
    balance = await token.balanceOf(wallet);
  } catch (error) {
    throw new Error(
      `could not read the ${tokenName} balance of ${wallet} at ${token.target}: ${providerMessage(error)}`,
      { cause: error }
    );
  }
  return ethers.formatEther(balance);
}
